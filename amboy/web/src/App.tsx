import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./store/auth";
import { SignIn } from "./pages/SignIn";
import { Home } from "./pages/Home";
import { UploadArtifact } from "./pages/UploadArtifact";
import { NewComparison } from "./pages/NewComparison";
import { Workspace } from "./pages/Workspace";
import { Governance } from "./pages/Governance";
import type { ReactNode } from "react";

function Protected({ children }: { children: ReactNode }) {
  const authed = useAuth((s) => s.authenticated);
  if (!authed) return <Navigate to="/signin" replace />;   // TC-46
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/upload" element={<Protected><UploadArtifact /></Protected>} />
      <Route path="/new" element={<Protected><NewComparison /></Protected>} />
      <Route path="/c/:id" element={<Protected><Workspace /></Protected>} />
      <Route path="/governance" element={<Protected><Governance /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
