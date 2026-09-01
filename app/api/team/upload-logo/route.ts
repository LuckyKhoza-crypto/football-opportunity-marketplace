import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[upload-logo ${requestId}] Starting upload request`);

  try {
    // 1. Verify authentication
    const session = await getServerSession(authOptions);
    console.log(`[upload-logo ${requestId}] Session:`, {
      hasSession: !!session,
      userId: session?.user?.id,
      email: session?.user?.email,
      role: session?.user?.role,
    });

    if (!session?.user?.id) {
      console.error(`[upload-logo ${requestId}] No authenticated session`);
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // 2. Parse the form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    console.log(`[upload-logo ${requestId}] File received:`, {
      hasFile: !!file,
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
    });

    if (!file) {
      console.error(`[upload-logo ${requestId}] No file in request`);
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    // 3. Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      console.error(
        `[upload-logo ${requestId}] Invalid file type: ${file.type}`,
      );
      return NextResponse.json(
        { error: "Only JPG, PNG, and WebP files are allowed" },
        { status: 400 },
      );
    }

    // 4. Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      console.error(
        `[upload-logo ${requestId}] File too large: ${file.size} bytes`,
      );
      return NextResponse.json(
        { error: "File size must be less than 5MB" },
        { status: 400 },
      );
    }

    // 5. Upload to Supabase Storage using admin client (bypasses RLS)
    const fileExt = file.name.split(".").pop() || "jpg";
    const fileName = `${session.user.id}/${crypto.randomUUID()}.${fileExt}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    console.log(`[upload-logo ${requestId}] Uploading to storage:`, {
      bucket: "team-logos",
      fileName,
      fileSize: fileBuffer.length,
    });

    const { error: uploadError } = await supabaseAdmin.storage
      .from("team-logos")
      .upload(fileName, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error(
        `[upload-logo ${requestId}] Supabase storage upload failed:`,
        {
          message: uploadError.message,
          name: uploadError.name,
          statusCode: (uploadError as { statusCode?: number }).statusCode,
        },
      );
      return NextResponse.json(
        { error: "Failed to upload logo to storage" },
        { status: 500 },
      );
    }

    // 6. Get the public URL
    const {
      data: { publicUrl },
    } = supabaseAdmin.storage
      .from("team-logos")
      .getPublicUrl(fileName);

    console.log(`[upload-logo ${requestId}] Upload successful:`, {
      fileName,
      publicUrl,
    });

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error(`[upload-logo ${requestId}] Unexpected error:`, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}