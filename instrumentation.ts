export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensurePiAgentsDirectory } = await import("@/lib/pi-directories");
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");

  await ensurePiAgentsDirectory();
  configureHttpDispatcher();
}
