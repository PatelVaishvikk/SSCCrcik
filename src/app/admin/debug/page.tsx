import { getAdminSession } from "@/lib/admin-session";
import { cookies } from "next/headers";

export default async function DebugPage() {
  const session = await getAdminSession();
  const cookieStore = await cookies();
  const token = cookieStore.get("ssc_session");

  return (
    <div style={{ padding: 40 }}>
      <h1>Debug Session</h1>
      <pre>
        {JSON.stringify(
          {
            session,
            tokenValue: token?.value,
            hasToken: !!token,
            cookieName: token?.name,
            envSecretSet: !!process.env.JWT_SECRET,
          },
          null,
          2
        )}
      </pre>
    </div>
  );
}
