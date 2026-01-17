import AdminProgressTracker from "@/components/admin/AdminProgressTracker";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AdminProgressTracker />
      {children}
    </>
  );
}
