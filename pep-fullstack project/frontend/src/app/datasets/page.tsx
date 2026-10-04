import { DatasetsView } from "@/components/ml/DatasetsView";

export default function DatasetsPage() {
  return (
    <div className="w-full p-6">
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-label-primary">
        Datasets &amp; statistics
      </h1>
      <p className="mb-6 text-[15px] text-label-secondary">
        The benchmark, synthetic and government data behind the ML layer.
      </p>
      <DatasetsView />
    </div>
  );
}
