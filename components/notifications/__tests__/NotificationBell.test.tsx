// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@test.com",
      },
    },
  }),
}));

// Mock the realtime hook
vi.mock("@/lib/use-notifications-realtime", () => ({
  useNotificationsRealtime: () => ({}),
}));

const mockNotifications = [
  {
    id: "notif-1",
    user_id: "user-1",
    type: "message_received",
    title: "New message",
    body: "Test Team sent you a new message.",
    link: "/messages/conv-1",
    source_id: null,
    read_at: null,
    created_at: new Date().toISOString(),
  },
];

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: mockNotifications,
        unread_count: 1,
      }),
    }) as any;
  });

  it("renders bell with unread badge", async () => {
    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Wait for the badge to appear
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("opens dropdown showing recent notifications", async () => {
    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => {
      expect(screen.getByText("New message")).toBeInTheDocument();
    });

    expect(screen.getByText("Test Team sent you a new message.")).toBeInTheDocument();
    expect(screen.getByText("View all notifications")).toBeInTheDocument();
  });

  it("shows empty state when there are no notifications", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: [],
        unread_count: 0,
      }),
    }) as any;

    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => {
      expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
    });
  });

  it("view all notifications navigates to /notifications", async () => {
    pushMock.mockClear();

    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => {
      expect(screen.getByText("View all notifications")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("View all notifications"));

    expect(pushMock).toHaveBeenCalledWith("/notifications");
  });
});