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

// Mock useNotifications hook
const mockNotifications = [
  {
    id: "notif-1",
    user_id: "user-1",
    type: "message_received" as const,
    title: "New message",
    body: "Test Team sent you a new message.",
    link: "/messages/conv-1",
    source_id: null,
    read_at: null,
    created_at: new Date().toISOString(),
  },
];

const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/lib/use-notifications", () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: 1,
    loading: false,
    error: null,
    refresh: mockRefresh,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
  }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders bell with unread badge", async () => {
    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("opens dropdown showing recent notifications", async () => {
    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell
    fireEvent.click(screen.getByLabelText("Notifications"));

    expect(screen.getByText("New message")).toBeInTheDocument();
    expect(screen.getByText("Test Team sent you a new message.")).toBeInTheDocument();
    expect(screen.getByText("View all notifications")).toBeInTheDocument();
  });

  it("view all notifications navigates to /notifications", async () => {
    pushMock.mockClear();

    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell
    fireEvent.click(screen.getByLabelText("Notifications"));

    expect(screen.getByText("View all notifications")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View all notifications"));

    expect(pushMock).toHaveBeenCalledWith("/notifications");
  });

  it("clicking a notification marks it read and navigates", async () => {
    pushMock.mockClear();

    const { NotificationBell } = await import("../NotificationBell");
    render(<NotificationBell />);

    // Click the bell to open dropdown
    fireEvent.click(screen.getByLabelText("Notifications"));

    // Click the notification
    fireEvent.click(screen.getByText("New message"));

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("notif-1");
      expect(pushMock).toHaveBeenCalledWith("/messages/conv-1");
    });
  });
});