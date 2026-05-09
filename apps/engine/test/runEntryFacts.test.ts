import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getBoard } from "../src/api/board.js"
import { projectItemDetail } from "../src/api/routes/items.js"
import { resolveChatEntryFact, resolveMessagesEntryFact } from "../src/core/itemRunEntryFacts.js"
import { initDatabase, type Db } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-entry-facts-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Run entry item", description: "desc" })
  const cleanup = () => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { db, repos, workspace, item, cleanup }
}

function setRunCreatedAt(db: Db, runId: string, createdAt: number): void {
  db.prepare("UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?").run(createdAt, createdAt, runId)
}

function createRunAt(
  db: Db,
  repos: Repos,
  input: { workspaceId: string; itemId: string; title: string; createdAt: number; status?: "running" | "failed" | "completed" | "blocked" },
) {
  const run = repos.createRun({
    workspaceId: input.workspaceId,
    itemId: input.itemId,
    title: input.title,
  })
  setRunCreatedAt(db, run.id, input.createdAt)
  if (input.status && input.status !== "running") repos.updateRun(run.id, { status: input.status })
  return repos.getRun(run.id)!
}

function addConversationEntry(repos: Repos, runId: string, message = "Conversation entry"): void {
  repos.appendLog({
    runId,
    eventType: "chat_message",
    message,
    data: {
      role: "assistant",
      source: "stage-agent",
      requiresResponse: false,
    },
  })
}

function addOpenPrompt(repos: Repos, runId: string, prompt = "Need input"): void {
  repos.createPendingPrompt({ runId, prompt })
}

function addDefaultVisibleMessage(repos: Repos, runId: string, itemId: string, title = "Run started"): void {
  repos.appendLog({
    runId,
    eventType: "run_started",
    message: title,
    data: { itemId, title },
  })
}

test("chat entry prefers the newest run with an open prompt regardless of lifecycle status", () => {
  const fx = createFixture()
  try {
    const olderConversation = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Older conversation",
      createdAt: 100,
      status: "running",
    })
    addConversationEntry(fx.repos, olderConversation.id)

    const newerPrompt = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newer failed prompt",
      createdAt: 200,
      status: "failed",
    })
    addOpenPrompt(fx.repos, newerPrompt.id)

    assert.deepEqual(
      resolveChatEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: newerPrompt.id },
    )
  } finally {
    fx.cleanup()
  }
})

test("an older open-prompt run beats a newer conversation-only run", () => {
  const fx = createFixture()
  try {
    const olderPrompt = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Older prompt",
      createdAt: 100,
    })
    addOpenPrompt(fx.repos, olderPrompt.id)

    const newerConversation = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newer conversation",
      createdAt: 200,
    })
    addConversationEntry(fx.repos, newerConversation.id)

    assert.deepEqual(
      resolveChatEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: olderPrompt.id },
    )
  } finally {
    fx.cleanup()
  }
})

test("chat entry falls back to the newest run with conversation when no prompt is open", () => {
  const fx = createFixture()
  try {
    const noSignal = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "No signal",
      createdAt: 300,
    })
    const olderConversation = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Older conversation",
      createdAt: 100,
    })
    addConversationEntry(fx.repos, olderConversation.id)
    const newerConversation = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newer conversation",
      createdAt: 200,
    })
    addConversationEntry(fx.repos, newerConversation.id)

    assert.deepEqual(
      resolveChatEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: newerConversation.id },
    )
    assert.notEqual(noSignal.id, newerConversation.id)
  } finally {
    fx.cleanup()
  }
})

test("board and item read surfaces expose both run-entry facts with explicit no-target support", () => {
  const fx = createFixture()
  try {
    const messagesRun = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Messages run",
      createdAt: 100,
    })
    addDefaultVisibleMessage(fx.repos, messagesRun.id, fx.item.id, "Started")

    const chatRun = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Chat run",
      createdAt: 200,
    })
    addOpenPrompt(fx.repos, chatRun.id)

    const boardCard = getBoard(fx.db, fx.workspace.key).columns
      .flatMap((column) => column.cards)
      .find((card) => card.itemId === fx.item.id)
    const itemDetail = projectItemDetail(fx.repos, fx.item.id)

    assert.ok(boardCard)
    assert.ok(itemDetail)
    assert.deepEqual(boardCard.chatEntry, { status: "resolved", targetRunId: chatRun.id })
    assert.deepEqual(boardCard.messagesEntry, { status: "resolved", targetRunId: messagesRun.id })
    assert.equal(boardCard.chatEntryFreshness.strategy, "workspace_sse")
    assert.equal(boardCard.messagesEntryFreshness.strategy, "workspace_sse")
    assert.deepEqual((itemDetail as { chatEntry: unknown }).chatEntry, { status: "resolved", targetRunId: chatRun.id })
    assert.deepEqual((itemDetail as { messagesEntry: unknown }).messagesEntry, { status: "resolved", targetRunId: messagesRun.id })
  } finally {
    fx.cleanup()
  }
})

test("messages entry uses the newest run whose default messages view is non-empty and refreshes on the next read", () => {
  const fx = createFixture()
  try {
    const olderVisible = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Older visible run",
      createdAt: 100,
    })
    addDefaultVisibleMessage(fx.repos, olderVisible.id, fx.item.id, "Older started")

    const newerHidden = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newer hidden run",
      createdAt: 200,
    })
    addConversationEntry(fx.repos, newerHidden.id, "Only level-0 chat")

    assert.deepEqual(
      resolveMessagesEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: olderVisible.id },
    )

    const newestVisible = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newest visible run",
      createdAt: 300,
    })
    addDefaultVisibleMessage(fx.repos, newestVisible.id, fx.item.id, "Newest started")

    assert.deepEqual(
      resolveMessagesEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: newestVisible.id },
    )
  } finally {
    fx.cleanup()
  }
})

test("changing prompt state can switch the chat target without switching messages", () => {
  const fx = createFixture()
  try {
    const olderPromptAndMessages = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Older prompt + messages",
      createdAt: 100,
    })
    addOpenPrompt(fx.repos, olderPromptAndMessages.id)
    addDefaultVisibleMessage(fx.repos, olderPromptAndMessages.id, fx.item.id, "Older started")

    const newerConversationOnly = createRunAt(fx.db, fx.repos, {
      workspaceId: fx.workspace.id,
      itemId: fx.item.id,
      title: "Newer conversation only",
      createdAt: 200,
    })
    addConversationEntry(fx.repos, newerConversationOnly.id)

    assert.deepEqual(
      resolveChatEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: olderPromptAndMessages.id },
    )
    assert.deepEqual(
      resolveMessagesEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: olderPromptAndMessages.id },
    )

    addOpenPrompt(fx.repos, newerConversationOnly.id, "Newest prompt opened")

    assert.deepEqual(
      resolveChatEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: newerConversationOnly.id },
    )
    assert.deepEqual(
      resolveMessagesEntryFact(fx.repos, fx.repos.listRunsForItem(fx.item.id)),
      { status: "resolved", targetRunId: olderPromptAndMessages.id },
    )
  } finally {
    fx.cleanup()
  }
})
