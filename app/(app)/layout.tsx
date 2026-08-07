import { TabBar } from '@/components/shell/TabBar'

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <div className="flex-1">{children}</div>
      <TabBar />
    </>
  )
}
