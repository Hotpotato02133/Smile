import { AuthHeaderControls } from "@/components/auth/auth-header-controls";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">Smile</span>
        <AuthHeaderControls />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Smile</h1>
        <p className="max-w-md text-muted-foreground">
          Multi-tenant dental scheduling for modern clinics.
        </p>
      </main>
    </div>
  );
}
