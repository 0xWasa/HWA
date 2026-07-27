import { AcquisitionResultScreen } from "@/components/acquisitions/AcquisitionResultScreen";

export default async function AcquisitionResultPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const id = /^\d+$/.test(requestId) ? BigInt(requestId) : 0n;
  return <AcquisitionResultScreen requestId={id} />;
}
