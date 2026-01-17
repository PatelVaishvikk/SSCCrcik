import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const events = await db
    .collection("events")
    .find(
      {},
      {
        projection: {
          event_id: 1,
          year: 1,
          type: 1,
          event_name: 1,
          start_date: 1,
          end_date: 1,
          event_index: 1,
        },
      }
    )
    .sort({ year: -1, type: 1, event_index: 1 })
    .toArray();

  const payload = events.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });

  return NextResponse.json({ events: payload });
}
