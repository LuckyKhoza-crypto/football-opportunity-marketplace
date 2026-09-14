import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const channelSecret = process.env.REALTIME_CHANNEL_SECRET ?? "";

export function getUserChannelName(userId: string): string {
  return `user:${userId}`;
}

export function getConversationChannelName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export interface SignedChannel {
  channel: string;
  signature: string;
  expires_at: number;
}

export function signChannel(
  channel: string,
  userId: string,
  ttlMs = 5 * 60 * 1000,
): SignedChannel {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${channel}:${userId}:${expiresAt}`;
  const signature = createHmac("sha256", channelSecret)
    .update(payload)
    .digest("hex");
  return { channel, signature, expires_at: expiresAt };
}

export function verifySignedChannel(
  signed: SignedChannel,
  userId: string,
): boolean {
  if (!channelSecret) return false;
  if (Date.now() > signed.expires_at) return false;
  const payload = `${signed.channel}:${userId}:${signed.expires_at}`;
  const expected = createHmac("sha256", channelSecret)
    .update(payload)
    .digest("hex");
  const a = Buffer.from(signed.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let broadcastClient: ReturnType<typeof createClient> | null = null;

function getBroadcastClient() {
  if (!broadcastClient) {
    broadcastClient = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return broadcastClient;
}

async function broadcastToChannel(
  channelName: string,
  event: string,
  payload: Record<string, unknown>,
  signedForUserId?: string,
): Promise<void> {
  try {
    const client = getBroadcastClient();
    const channel = client.channel(channelName);
    await channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        const fullPayload = signedForUserId
          ? { ...payload, _signed: signChannel(channelName, signedForUserId) }
          : payload;
        channel.send({ type: "broadcast", event, payload: fullPayload });
        setTimeout(() => {
          try {
            client.removeChannel(channel);
          } catch {
            // ignore
          }
        }, 1000);
      }
    });
  } catch (err) {
    console.error("Failed to emit realtime event:", err);
  }
}

export async function emitToUser(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await broadcastToChannel(getUserChannelName(userId), event, payload, userId);
}

export async function emitToConversation(
  conversationId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await broadcastToChannel(
    getConversationChannelName(conversationId),
    event,
    payload,
  );
}