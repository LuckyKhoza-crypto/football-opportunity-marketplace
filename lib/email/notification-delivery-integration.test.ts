import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/realtime-broadcast", () => ({
  emitToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/notification-delivery", () => ({
  enqueueEmailDeliveryForNotification: vi.fn().mockResolvedValue({ enqueued: true }),
  scheduleEmailDeliveryProcessing: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { emitToUser } from "@/lib/realtime-broadcast";
import {
  enqueueEmailDeliveryForNotification,
  scheduleEmailDeliveryProcessing,
} from "@/lib/email/notification-delivery";
import { createNotification } from "@/lib/notifications";

function mockNotificationInsert(result: { data: unknown; error: unknown }) {
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(
    () =>
      ({
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue(result),
          }),
        }),
      }) as never,
  );
}

describe("EMAIL-002: createNotification integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues an email delivery after a notification is created", async () => {
    mockNotificationInsert({ data: { id: "notif-1" }, error: null });

    await createNotification({
      userId: "user-1",
      type: "message_received",
      title: "New message",
      body: "Hello",
      link: "/messages/1",
      sourceId: "msg-1",
    });

    expect(enqueueEmailDeliveryForNotification).toHaveBeenCalledTimes(1);
    expect(enqueueEmailDeliveryForNotification).toHaveBeenCalledWith({
      notificationId: "notif-1",
      userId: "user-1",
      type: "message_received",
    });
    // EMAIL-002A: a fresh enqueue triggers the immediate best-effort processor.
    expect(scheduleEmailDeliveryProcessing).toHaveBeenCalledTimes(1);
  });

  it("does not trigger immediate processing when nothing was enqueued (EMAIL-002A)", async () => {
    mockNotificationInsert({ data: { id: "notif-skip" }, error: null });
    vi.mocked(enqueueEmailDeliveryForNotification).mockResolvedValueOnce({
      enqueued: false,
      skipped: true,
    });

    await createNotification({
      userId: "user-skip",
      type: "message_received",
      title: "New message",
      body: "Hi",
      sourceId: "msg-skip",
    });

    expect(scheduleEmailDeliveryProcessing).not.toHaveBeenCalled();
  });

  it("does not trigger immediate processing for a deduplicated delivery (EMAIL-002A)", async () => {
    mockNotificationInsert({ data: { id: "notif-dedupe" }, error: null });
    vi.mocked(enqueueEmailDeliveryForNotification).mockResolvedValueOnce({
      enqueued: false,
      deduplicated: true,
    });

    await createNotification({
      userId: "user-dedupe",
      type: "message_received",
      title: "New message",
      body: "Hi",
      sourceId: "msg-dedupe",
    });

    expect(scheduleEmailDeliveryProcessing).not.toHaveBeenCalled();
  });

  it("never fails notification creation when the immediate trigger throws (EMAIL-002A)", async () => {
    mockNotificationInsert({ data: { id: "notif-throw" }, error: null });
    vi.mocked(scheduleEmailDeliveryProcessing).mockImplementationOnce(() => {
      throw new Error("after() unavailable");
    });

    const result = await createNotification({
      userId: "user-throw",
      type: "message_received",
      title: "New message",
      body: "Hi",
      sourceId: "msg-throw",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "notif-throw" });
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it("still broadcasts the realtime event (behavior unchanged)", async () => {
    mockNotificationInsert({ data: { id: "notif-2" }, error: null });

    await createNotification({
      userId: "user-2",
      type: "message_received",
      title: "New message",
      body: "Hi",
      sourceId: "msg-2",
    });

    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith(
      "user-2",
      "notification_new",
      expect.objectContaining({ id: "notif-2", type: "message_received" }),
    );
  });

  it("does not enqueue a delivery for a deduplicated notification", async () => {
    mockNotificationInsert({ data: null, error: { code: "23505" } });

    const result = await createNotification({
      userId: "user-1",
      type: "message_received",
      title: "New message",
      body: "Dup",
      sourceId: "msg-1",
    });

    expect(result.deduplicated).toBe(true);
    expect(enqueueEmailDeliveryForNotification).not.toHaveBeenCalled();
  });

  it("never fails notification creation when the enqueue helper throws", async () => {
    mockNotificationInsert({ data: { id: "notif-3" }, error: null });
    vi.mocked(enqueueEmailDeliveryForNotification).mockRejectedValueOnce(
      new Error("email infra down"),
    );

    // Even if the enqueue helper rejects, createNotification must survive and
    // still broadcast the in-app notification.
    const result = await createNotification({
      userId: "user-3",
      type: "message_received",
      title: "New message",
      body: "Hi",
      sourceId: "msg-3",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "notif-3" });
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });
});