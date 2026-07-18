import { redirect } from "next/navigation";

/** Documents are now generated from within a client's workspace — one workflow. */
export default function NewRunRedirect() {
  redirect("/");
}
