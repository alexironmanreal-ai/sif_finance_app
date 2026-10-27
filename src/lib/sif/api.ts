import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") throw new Error("Datos inválidos.");
  return data as Record<string, unknown>;
}

export const getSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { session } = await import("@/server/sif/read.server");
    return session(context.userId);
  });

export const bootstrapCeo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { name: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { bootstrapCeo } = await import("@/server/sif/write.server");
    return bootstrapCeo(context.userId, data.name);
  });

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { dashboard } = await import("@/server/sif/read.server");
    return dashboard(context.userId, data.period);
  });

export const fetchSales = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { listSales } = await import("@/server/sif/read.server");
    return listSales(context.userId);
  });

export const fetchSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { saleDetail } = await import("@/server/sif/read.server");
    return saleDetail(context.userId, data.id);
  });

export const saveSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveSale } = await import("@/server/sif/write.server");
    return saveSale(context.userId, data as never);
  });

export const addPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { addPayment } = await import("@/server/sif/write.server");
    return addPayment(context.userId, data as never);
  });

export const addRefund = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { addRefund } = await import("@/server/sif/write.server");
    return addRefund(context.userId, data as never);
  });

export const fetchExpenses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { listExpenses } = await import("@/server/sif/read.server");
    return listExpenses(context.userId);
  });

export const saveExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveExpense } = await import("@/server/sif/write.server");
    return saveExpense(context.userId, data as never);
  });

export const payExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { payExpense } = await import("@/server/sif/write.server");
    return payExpense(context.userId, data as never);
  });

export const saveObligation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveObligation } = await import("@/server/sif/write.server");
    return saveObligation(context.userId, data as never);
  });

export const payObligation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { payObligation } = await import("@/server/sif/write.server");
    return payObligation(context.userId, data as never);
  });

export const fetchCampaigns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { listCampaigns } = await import("@/server/sif/read.server");
    return listCampaigns(context.userId);
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveCampaign } = await import("@/server/sif/write.server");
    return saveCampaign(context.userId, data);
  });

export const fetchProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { listProjects } = await import("@/server/sif/read.server");
    return listProjects(context.userId);
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveProject } = await import("@/server/sif/write.server");
    return saveProject(context.userId, data);
  });

export const saveMilestone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveMilestone } = await import("@/server/sif/write.server");
    return saveMilestone(context.userId, data);
  });

export const reviewMilestone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { reviewMilestone } = await import("@/server/sif/write.server");
    return reviewMilestone(context.userId, data as never);
  });

export const fetchPeople = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { listPeopleOps } = await import("@/server/sif/read.server");
    return listPeopleOps(context.userId, data.period);
  });

export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { targetId: string; roles: string[] }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { setMemberRole } = await import("@/server/sif/write.server");
    return setMemberRole(context.userId, data);
  });

export const setMemberActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { targetId: string; active: boolean }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { setMemberActive } = await import("@/server/sif/write.server");
    return setMemberActive(context.userId, data.targetId, data.active);
  });

export const saveObjective = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveObjective } = await import("@/server/sif/write.server");
    return saveObjective(context.userId, data);
  });

export const saveObjectiveResult = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveObjectiveResult } = await import("@/server/sif/write.server");
    return saveObjectiveResult(context.userId, data as never);
  });

export const saveSetterLog = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveSetterLog } = await import("@/server/sif/write.server");
    return saveSetterLog(context.userId, data);
  });

export const saveContribution = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveContribution } = await import("@/server/sif/write.server");
    return saveContribution(context.userId, data);
  });

export const saveAgreement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveAgreement } = await import("@/server/sif/write.server");
    return saveAgreement(context.userId, data);
  });

export const fetchCompensation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { listCompensation } = await import("@/server/sif/read.server");
    return listCompensation(context.userId, data.period);
  });

export const materialize = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { materialize } = await import("@/server/sif/write.server");
    return materialize(context.userId, data.period);
  });

export const decideCompensation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { decideCompensation } = await import("@/server/sif/write.server");
    return decideCompensation(context.userId, data as never);
  });

export const payCompensation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { payCompensation } = await import("@/server/sif/write.server");
    return payCompensation(context.userId, data as never);
  });

export const fetchDistribution = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { distribution } = await import("@/server/sif/read.server");
    return distribution(context.userId, data.period);
  });

export const storeProposal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { storeProposal } = await import("@/server/sif/write.server");
    return storeProposal(context.userId, data.period);
  });

export const decideDistribution = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { decideDistribution } = await import("@/server/sif/write.server");
    return decideDistribution(context.userId, data as never);
  });

export const fetchClosing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { closingPack } = await import("@/server/sif/read.server");
    return closingPack(context.userId, data.period);
  });

export const saveChecklist = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveChecklist } = await import("@/server/sif/write.server");
    return saveChecklist(context.userId, data as never);
  });

export const closeMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string; decision: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { closeMonth } = await import("@/server/sif/write.server");
    return closeMonth(context.userId, data);
  });

export const fetchReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { period: string }) => data)
  .handler(async ({ context, data }): Promise<any> => {
    const { report } = await import("@/server/sif/read.server");
    return report(context.userId, data.period);
  });

export const fetchAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { auditLog } = await import("@/server/sif/read.server");
    return auditLog(context.userId);
  });

export const fetchSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<any> => {
    const { settingsView } = await import("@/server/sif/read.server");
    return settingsView(context.userId);
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveSettings } = await import("@/server/sif/write.server");
    return saveSettings(context.userId, data);
  });

export const saveRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => asRecord(data))
  .handler(async ({ context, data }): Promise<any> => {
    const { saveRule } = await import("@/server/sif/write.server");
    return saveRule(context.userId, data);
  });
