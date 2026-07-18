import { redirect } from "next/navigation";

/** The old Clients & templates page — clients now live on the home page. */
export default function ClientsRedirect() {
  redirect("/");
}
