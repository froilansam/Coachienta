/** Plain paste gate. Deliberately unstyled — design lands in P0b (PRD-007 §8). */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>
}) {
  const { e } = await searchParams
  return (
    <main>
      <h1>Coachienta</h1>
      {e ? <p role="alert">That token was not recognised.</p> : null}
      <form method="post" action="/api/unlock">
        <label htmlFor="token">Access token</label>
        <input id="token" name="token" type="password" autoComplete="off" required />
        <button type="submit">Unlock</button>
      </form>
      <p>Once per device. No account, nothing to log out of.</p>
    </main>
  )
}
