import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./context/AuthContext";
import { Role } from "./api/types";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tickets from "./pages/Tickets";
import NewTicket from "./pages/NewTicket";
import NewTicketChat from "./pages/NewTicketChat";
import TicketDetail from "./pages/TicketDetail";
import Preferences from "./pages/Preferences";
import { KnowledgeArticle, KnowledgeEditor, KnowledgeList } from "./pages/Knowledge";
import { AiSettings, Automation, Governance, Integrations, Sla, Team } from "./pages/admin/Admin";
import { Users } from "./pages/admin/Users";

function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner size={28} /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

const Home = () => (useAuth().user?.role === "END_USER" ? <Navigate to="/tickets" replace /> : <Dashboard />);
// Employees raise tickets by talking to the assistant; staff keep the structured form.
const NewTicketRoute = () => (useAuth().user?.role === "END_USER" ? <NewTicketChat /> : <NewTicket />);
const staff: Role[] = ["AGENT", "ADMIN"];
const P = (el: ReactNode, roles?: Role[]) => <Protected roles={roles}>{el}</Protected>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={P(<Home />)} />
      <Route path="/tickets" element={P(<Tickets />)} />
      <Route path="/tickets/new" element={P(<NewTicketRoute />)} />
      <Route path="/tickets/:id" element={P(<TicketDetail />)} />
      <Route path="/kb" element={P(<KnowledgeList />)} />
      <Route path="/kb/new" element={P(<KnowledgeEditor />, staff)} />
      <Route path="/kb/:id" element={P(<KnowledgeArticle />)} />
      <Route path="/kb/:id/edit" element={P(<KnowledgeEditor />, staff)} />
      <Route path="/preferences" element={P(<Preferences />)} />
      <Route path="/admin/users" element={P(<Users />, ["ADMIN"])} />
      <Route path="/admin/team" element={P(<Team />, ["ADMIN"])} />
      <Route path="/admin/sla" element={P(<Sla />, ["ADMIN"])} />
      <Route path="/admin/automation" element={P(<Automation />, ["ADMIN"])} />
      <Route path="/admin/ai" element={P(<AiSettings />, ["ADMIN"])} />
      <Route path="/admin/integrations" element={P(<Integrations />, ["ADMIN"])} />
      <Route path="/admin/governance" element={P(<Governance />, ["ADMIN"])} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
