"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-2xl font-semibold text-red-600">Something went wrong</h1>
      <pre className="mt-4 overflow-auto rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {error.message}
      </pre>
      {error.digest && (
        <p className="mt-2 text-xs text-muted-foreground">Digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
