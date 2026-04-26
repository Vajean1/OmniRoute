import { fetchAndPersistProviderLimits } from "@/lib/usage/providerLimits";
import { getConnectionRollingConsumption } from "@/lib/usage/connectionConsumption";

/**
 * GET /api/usage/[connectionId] - Get live usage data for a specific connection
 * and persist the refreshed Provider Limits cache.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params;
    const { usage, cache } = await fetchAndPersistProviderLimits(connectionId, "manual");
    const consumption = cache.consumption || getConnectionRollingConsumption(connectionId);
    return Response.json({
      ...usage,
      consumption,
    });
  } catch (error) {
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 500;
    const message = (error as Error)?.message || "Failed to fetch usage";
    console.error("[Usage API] Error fetching usage:", error);
    return Response.json({ error: message }, { status });
  }
}
