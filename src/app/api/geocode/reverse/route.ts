import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NominatimResponse = {
  display_name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  error?: string;
};

function buildShortAddress(data: NominatimResponse): string {
  const a = data.address ?? {};
  const street = a.road || a.pedestrian;
  const locality = a.neighbourhood || a.suburb;
  const city = a.city || a.town || a.village || a.county;
  const parts = [street, locality, city, a.state, a.postcode].filter(Boolean);
  if (parts.length >= 2) return parts.join(", ");
  return data.display_name || "";
}

/**
 * Reverse-geocode lat/lng to a human-readable place name.
 * Uses OpenStreetMap Nominatim (no API key). Coordinates remain source of truth.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng query params are required numbers" },
      { status: 400 },
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lat/lng out of range" }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        // Nominatim usage policy requires an identifying User-Agent
        "User-Agent": "insurance-copilot/0.1 (local roadside demo)",
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        {
          error: `Reverse geocode failed (${res.status})`,
          detail: body.slice(0, 200),
          lat,
          lng,
          locationText: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        },
        { status: 502 },
      );
    }

    const data = (await res.json()) as NominatimResponse;
    if (data.error) {
      return NextResponse.json(
        {
          error: data.error,
          lat,
          lng,
          locationText: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        },
        { status: 404 },
      );
    }

    const shortAddress = buildShortAddress(data);
    const locationText =
      shortAddress ||
      data.display_name ||
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    return NextResponse.json({
      lat,
      lng,
      locationText,
      displayName: data.display_name ?? locationText,
      address: data.address ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Reverse geocode failed",
        lat,
        lng,
        locationText: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      },
      { status: 502 },
    );
  }
}
