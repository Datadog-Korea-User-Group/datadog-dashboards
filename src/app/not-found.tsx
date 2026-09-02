import Link from "next/link";

/** URLs outside the [locale] segment, so no translations are available here. */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>404</h1>
          <p>
            Not found. <Link href="/">Go home</Link>.
          </p>
        </main>
      </body>
    </html>
  );
}
