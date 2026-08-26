import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default async function HomePage() {
  const user = await getSession();
  redirect(user ? "/dashboard" : "/login");
}
