// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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
  {
    id: "notif-2",
    user_id: "user-1",
    type: "application_status_changed" as const,
    title: "Application updated",
    body: "Your application for Striker at Phoenix United is now Accepted.",
    link: "/player/applications/app-1",
    source_id: null,
    read_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
];

const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();

vi.mock("@/lib/use-notifications", () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: 1,
    loading: false,
    error: null,
    refresh: vi.fn(),
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
  }),
}));

describe("NotificationsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders notifications with title, body, and unread state", async () => {
    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    expect(screen.getByText("New message")).toBeInTheDocument();
    expect(screen.getByText("Test Team sent you a new message.")).toBeInTheDocument();
    expect(screen.getByText("Application updated")).toBeInTheDocument();
    expect(screen.getByText("Your application for Striker at Phoenix United is now Accepted.")).toBeInTheDocument();
  });

  it("shows mark all as read button when there are unread notifications", async () => {
    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    expect(screen.getByText("Mark all as read")).toBeInTheDocument();
  });

  it("clicking a notification marks it as read and navigates", async () => {
    pushMock.mockClear();

    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    fireEvent.click(screen.getByText("New message"));

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("notif-1");
      expect(pushMock).toHaveBeenCalledWith("/messages/conv-1");
    });
  });

  it("mark all as read works", async () => {
    const { NotificationsClient } = await import("../NotificationsClient");
    render(<NotificationsClient />);

    fireEvent.click(screen.getByText("Mark all as read"));

    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalled();
    });
  });
});