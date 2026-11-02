"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { deleteEntity } from "./new/actions";

export interface EntityListItem {
  id: string;
  name: string | null;
  legalName: string | null;
  taxType: string | null;
  importedThrough: string | null;
  propertyAddress: string | null;
}

/**
 * Searchable entity grid for the ledger home page. Every typed word must match
 * somewhere in the entity's name / legal name / property address, so "ne 26th"
 * or "hospitality" both narrow naturally.
 */
export function EntitySearchList({ entities, canDelete }: { entities: EntityListItem[]; canDelete?: boolean }) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return entities;
    return entities.filter((e) => {
      const hay = [e.name, e.legalName, e.propertyAddress]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [entities, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entities…"
          aria-label="Search entities"
          autoFocus
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">
          {filtered.length === entities.length
            ? `${entities.length} entities`
            : `${filtered.length} of ${entities.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No entities match “{query}”.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((e) => (
            <div key={e.id} className="relative">
              <Link href={`/ledger/${e.id}`}>
                <Card className="transition-colors hover:border-zinc-400 dark:hover:border-zinc-500">
                  <CardHeader>
                    <CardTitle className="text-lg">{e.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      {e.taxType && <Badge variant="secondary">{e.taxType}</Badge>}
                      {e.importedThrough && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          through {e.importedThrough}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              {canDelete && deleting !== e.id && (
                <button
                  type="button"
                  onClick={(ev) => { ev.preventDefault(); setDeleting(e.id); }}
                  className="absolute right-3 top-3 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                >
                  Delete
                </button>
              )}
              {canDelete && deleting === e.id && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-xl bg-background/95 backdrop-blur-sm">
                  <span className="text-sm font-medium">Delete &ldquo;{e.name}&rdquo;?</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const fd = new FormData();
                        fd.set("entityId", e.id);
                        await deleteEntity(fd);
                      });
                    }}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {pending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(null)}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
