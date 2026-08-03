import { CaseDetail } from "@/components/CaseDetail";

type Props = { params: Promise<{ id: string }> };

export default async function CasePage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <CaseDetail caseId={id} />
    </div>
  );
}
