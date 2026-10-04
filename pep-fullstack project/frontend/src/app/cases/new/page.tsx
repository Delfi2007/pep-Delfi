"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Case } from "@/lib/types";

export default function NewCase() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [firNumber, setFirNumber] = useState("");
  const [station, setStation] = useState("");
  const [officer, setOfficer] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Case title is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          fir_number: firNumber || null,
          station: station || null,
          investigating_officer: officer || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create case (${res.status})`);
      const data: Case = await res.json();
      router.push(`/cases/${data.case_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full p-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-[15px] text-accent-blue"
      >
        <ChevronLeft className="size-4" />
        Cases
      </Link>

      <h1 className="mb-6 text-[22px] font-semibold tracking-tight text-label-primary">
        New Case
      </h1>

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <div className="divide-y divide-separator">
            <FormField
              label="Case title"
              value={title}
              onChange={setTitle}
              placeholder="Required"
              required
            />
            <FormField
              label="FIR number"
              value={firNumber}
              onChange={setFirNumber}
              placeholder="Optional"
              mono
            />
            <FormField
              label="Police station"
              value={station}
              onChange={setStation}
              placeholder="Optional"
            />
            <FormField
              label="Investigating officer"
              value={officer}
              onChange={setOfficer}
              placeholder="Optional"
            />
          </div>
        </Card>

        <Card className="mb-6 p-4">
          <label className="mb-1.5 block text-[13px] text-label-secondary">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional"
            className="w-full resize-none bg-transparent text-[15px] text-label-primary placeholder:text-label-tertiary focus:outline-none"
          />
        </Card>

        {error && <p className="mb-4 text-[13px] text-accent-red">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Creating…" : "Create case"}
        </Button>
      </form>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  required,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <label className="w-44 shrink-0 text-[15px] text-label-primary">
        {label}
        {required && <span className="text-accent-red"> *</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`flex-1 bg-transparent text-right text-[15px] text-label-primary placeholder:text-label-tertiary focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
