import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-3xl font-semibold">Live Support</h1>
        <p className="opacity-70">Agent dashboard for creating and taking support sessions.</p>
        <Link
          href="/agent"
          className="inline-block bg-white text-black px-5 py-2.5 rounded-lg font-medium"
        >
          Go to agent dashboard
        </Link>
      </div>
    </main>
  );
}
