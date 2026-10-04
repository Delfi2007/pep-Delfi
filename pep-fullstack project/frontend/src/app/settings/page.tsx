import { SettingsView } from "@/components/settings/SettingsView";

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-label-primary">
        Settings
      </h1>
      <p className="mb-6 text-[15px] text-label-secondary">
        The configuration this instance of ACPIA is running with.
      </p>
      <SettingsView />
    </div>
  );
}
