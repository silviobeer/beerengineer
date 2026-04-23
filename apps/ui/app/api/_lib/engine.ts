import { ENGINE_BASE_URL } from "@/lib/api"

const API_TOKEN = process.env.BEERENGINEER_API_TOKEN

export async function forwardToEngine(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (API_TOKEN) headers.set("x-beerengineer-token", API_TOKEN)

  return fetch(`${ENGINE_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  })
}
