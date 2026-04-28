import { sendTelegramTestNotification } from "../../notifications/command.js";
import { json } from "../http.js";
export async function handleNotificationTest(repos, loadConfig, res, channel) {
    const config = loadConfig();
    if (!config)
        return json(res, 500, { error: "config_unavailable" });
    if (channel !== "telegram")
        return json(res, 404, { error: "not found" });
    const result = await sendTelegramTestNotification(config, repos);
    if (!result.ok)
        return json(res, 400, { error: result.error });
    return json(res, 200, { ok: true });
}
export function handleNotificationDeliveries(repos, url, res) {
    const channel = url.searchParams.get("channel")?.trim() || undefined;
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : undefined;
    const deliveries = repos.listNotificationDeliveries({
        channel,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    json(res, 200, { deliveries });
}
