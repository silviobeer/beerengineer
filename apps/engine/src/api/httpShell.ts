import { createServer, type ServerResponse } from "node:http"
import type { Socket } from "node:net"

import { json, RequestBodyTooLargeError, setCors } from "./http.js"
import type { ApiHttpShell, ApiRequest, ApiRequestHandler } from "./entrypointContracts.js"

type CreateApiHttpShellOptions = {
  allowedOrigin: string
  host: string
  port: number
}

function writeUnhandledRouteError(res: ServerResponse, err: unknown): void {
  if (err instanceof RequestBodyTooLargeError) {
    if (!res.headersSent) json(res, err.statusCode, { error: "request_body_too_large" })
    else res.destroy()
    return
  }
  console.error("[api]", err)
  if (!res.headersSent) json(res, 500, { error: "internal_server_error" })
  else res.destroy()
}

export function createApiHttpShell(options: CreateApiHttpShellOptions): ApiHttpShell {
  const sockets = new Set<Socket>()
  let handler: ApiRequestHandler | null = null

  const server = createServer(async (req: ApiRequest, res) => {
    try {
      if (!req.url || !req.method) {
        json(res, 400, { error: "bad request" })
        return
      }
      setCors(res, req, options.allowedOrigin)
      if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
      }
      if (!handler) {
        json(res, 503, { error: "service_unavailable", code: "service_unavailable" })
        return
      }
      await handler(req, res)
    } catch (err) {
      writeUnhandledRouteError(res, err)
    }
  })

  server.on("connection", socket => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })

  return {
    setRequestHandler(nextHandler: ApiRequestHandler): void {
      handler = nextHandler
    },
    listen(onListening?: () => void): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => {
          server.off("listening", onListeningEvent)
          reject(err)
        }
        const onListeningEvent = () => {
          server.off("error", onError)
          onListening?.()
          resolve()
        }
        server.once("error", onError)
        server.once("listening", onListeningEvent)
        server.listen(options.port, options.host)
      })
    },
    close(): Promise<Error | undefined> {
      return new Promise(resolve => {
        server.close(closeErr => resolve(closeErr ?? undefined))
      })
    },
    destroyTrackedSocketsAfter(delayMs: number): void {
      setTimeout(() => {
        sockets.forEach(socket => socket.destroy())
      }, delayMs).unref?.()
    },
    destroyTrackedSockets(): void {
      sockets.forEach(socket => socket.destroy())
    },
  }
}
