// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRouter } from "next/navigation";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

// Mock the NotificationsClient component's fetch calls
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
  {
    id: "notif-2",
    user_id: "user-1",
    type: "application_status_changed",
    title: "Application updated",
    body: "Your application for Striker at Phoenix United is now Accepted.",
    link: "/player/applications/app-1",
    source_id: null,
    read_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
];

describe("NotificationsClient", () => {
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

  it("renders notifications with title, body, and unread state", async () => {
    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    // Wait for notifications to load
    await waitFor(() => {
      expect(screen.getByText("New message")).toBeInTheDocument();
    });

    expect(screen.getByText("Test Team sent you a new message.")).toBeInTheDocument();
    expect(screen.getByText("Application updated")).toBeInTheDocument();
    expect(screen.getByText("Your application for Striker at Phoenix United is now Accepted.")).toBeInTheDocument();
  });

  it("shows mark all as read button when there are unread notifications", async () => {
    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    await waitFor(() => {
      expect(screen.getByText("New message")).toBeInTheDocument();
    });

    expect(screen.getByText("Mark all as read")).toBeInTheDocument();
  });

  it("clicking a notification marks it as read and navigates", async () => {
    pushMock.mockClear();

    // Mock the mark-read API
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes("/read") && options?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unread_count: 1,
        }),
      });
    }) as any;

    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    await waitFor(() => {
      expect(screen.getByText("New message")).toBeInTheDocument();
    });

    // Click the unread notification
    fireEvent.click(screen.getByText("New message"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/messages/conv-1");
    });
  });

  it("mark all as read works", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes("/read-all") && options?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, marked_count: 1 }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unread_count: 1,
        }),
      });
    }) as any;

    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    await waitFor(() => {
      expect(screen.getByText("Mark all as read")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Mark all as read"));

    await waitFor(() => {
      // After mark-all, the button should disappear (no unread)
      expect(screen.queryByText("Mark all as read")).not.toBeInTheDocument();
    });
  });

  it("shows empty state when there are no notifications", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: [],
        unread_count: 0,
      }),
    }) as any;

    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    await waitFor(() => {
      expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
    });
  });

  it("shows error state with retry when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as any;

    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load notifications. Please try again.")).toBeInTheDocument();
    });

    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });
});