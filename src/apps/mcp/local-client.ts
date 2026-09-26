import { executeManagedMail, type ManagedMailCommand } from "@ohmyhost/sdk-ts";
import {
  assertProjectDatabaseAccess,
  assertProjectDatabaseAccessCredential,
  assertProjectDatabaseAccessPage,
  assertProjectDatabaseWriteReceipt,
} from "@ohmyhost/contracts/database-access";
import { assertOrganizationAccount } from "@ohmyhost/contracts/credit-pricing";
import { assertDatabaseCompute } from "@ohmyhost/contracts/database-compute";
import {
  assertProjectContext,
  assertProjectNotesReceipt,
} from "@ohmyhost/contracts/project-context";
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { assertProjectExport } from "@ohmyhost/contracts/project-exports";
import { parseUserApiKeyPage } from "@ohmyhost/contracts/user-api-keys";
import { parseFeedbackReceipt, parseFeedbackStatus } from "@ohmyhost/contracts/feedback";
import { assertOrganizationCreditUsage } from "@ohmyhost/contracts/credit-pricing";
import {
  assertBillingCheckout,
  assertBillingPortal,
  assertRecharge,
} from "@ohmyhost/contracts/billing";
import {
  createProjectDevAccessTicket,
  ensureProjectDevShareLink,
  setProjectDevAccessMode,
  getProjectPoweredByFlag,
  setProjectPoweredByFlag,
  rotateProjectDevShareLink,
  revokeProjectDevShareLink,
  createCloudflareDnsAuthorization,
  getAccountProfile,
  getCloudflareDnsAuthorizationStatus,
  getProjectContext,
  setProjectNotes,
  getDatabaseCompute,
  changeDatabaseCompute,
  createClient,
  createProjectExport,
  getProjectExport,
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  createBillingCheckout,
  getBillingCheckout,
  createBillingPortal,
  getBillingRecharge,
  configureBillingRecharge,
  planPaidProjectDomain,
  applyPaidProjectDomain,
  getPaidProjectDomain,
  deletePaidProjectDomain,
  getOrganizationCredits,
  getOrganizationAccount,
  getOrganizationReferral,
  getOrganizationCreditUsage,
  getProjectCreditBudget,
  setProjectCreditBudget,
  createDeployment,
  createProject,
  submitFeedback,
  getFeedback,
  createOrganization,
  deleteEnvironmentSecret,
  deleteProject,
  getCurrentIdentity,
  getDeployment,
  changeProjectHandle,
  getProjectHandleAvailability,
  getOperation,
  getProject,
  getProjectSource,
  getProjectStatus,
  linkProjectSource,
  connectGithubOrganization,
  getGithubOrganizationConnection,
  listDeployments,
  listEnvironmentSecrets,
  listFunctionRuns,
  getDeploymentLogs,
  listProjects,
  planDeployment,
  planDeploymentRollback,
  planDeploymentPromotion,
  promoteDeployment,
  queryProjectDatabase,
  writeProjectDatabase,
  createProjectDatabaseAccess,
  listProjectDatabaseAccess,
  revokeProjectDatabaseAccess,
  planProjectDeletion,
  rollbackDeployment,
  reconcileOperation,
  streamOperationEvents,
  type DevAccessTicket,
  type DevAccessState,
  type PoweredByFlag,
  type OrganizationReferral,
  type CloudflareDnsAuthorization,
  type CloudflareDnsAuthorizationStatus,
  type OhMyHostClient,
  type Operation,
  type OperationEvent,
} from "@ohmyhost/sdk-ts";

import type {
  IdentityReport,
  LocalMcpProductClient,
  WorkspaceReport,
  WorkspaceSelectionReport,
} from "./local-server.js";
import {
  createAuthenticatedProductTransport,
  resolveProductCliEnvironment,
  prepareUserTokenFile,
  ProductApiAuthenticationError,
  parseDevAccessTicket,
  parseDevAccessState,
  parsePoweredByFlag,
  parseOrganizationReferral,
  parseCloudflareDnsAuthorization,
  parseCloudflareDnsAuthorizationStatus,
  parsePaidDomain,
  parsePaidDomainPlan,
  parseOperation,
  parseAccountProfile,
  parseCurrentIdentity,
  chooseWorkspace,
  publicProfile,
  publicWorkspace,
  selectWorkspace,
  InteractiveSessionRequiredError,
  type AuthenticatedProductApiOverrides,
  type EffectiveContext,
  type LocalProfile,
  type WorkspaceSession,
} from "@ohmyhost/product-cli";

export class OperationEventsUnavailableError extends Error {
  public constructor() {
    super("Operation events unavailable");
    this.name = "OperationEventsUnavailableError";
  }
}

/**
 * One client per tool call, for the login that call asked for. The process binding and the call's
 * own arguments choose it, so another agent's choice never changes which account a call uses.
 */
export async function createAuthenticatedLocalMcpClient(
  signal: AbortSignal,
  overrides: Omit<AuthenticatedProductApiOverrides, "productApiOrigin" | "selector"> = {},
): Promise<LocalMcpProductClient> {
  try {
    const transport = await createAuthenticatedProductTransport(signal, {
      ...overrides,
      selector: "mcp",
    });
    return new GeneratedSdkLocalMcpClient(
      transport.baseUrl,
      transport.accessToken,
      transport.fetch,
      transport.workspace,
      transport.context,
      resolveProductCliEnvironment(overrides.environment).commandPrefix,
    );
  } catch (error) {
    if (!(error instanceof ProductApiAuthenticationError)) throw error;
    if (error.code === "invalid_environment_token")
      throw new Error(
        "invalid_environment_token. Supply a valid OHMYHOST_TOKEN or unset it before interactive login.",
      );
    const environment = overrides.environment?.OHMYHOST_ENVIRONMENT ?? "production";
    throw new Error(
      `${error.code}. Run OHMYHOST_ENVIRONMENT=${environment} ohmyhost login and retry.`,
    );
  }
}

export class GeneratedSdkLocalMcpClient implements LocalMcpProductClient {
  #client: OhMyHostClient;

  #workspace: WorkspaceSession | undefined;

  readonly #context: EffectiveContext;

  readonly #commandPrefix: string;

  readonly #rescope: (accessToken: string) => OhMyHostClient;

  public constructor(
    baseUrl: string,
    accessToken: string,
    fetch: typeof globalThis.fetch,
    workspace?: WorkspaceSession,
    context?: EffectiveContext,
    commandPrefix = "OHMYHOST_ENVIRONMENT=production ohmyhost",
  ) {
    this.#rescope = (token) => createClient({ auth: token, baseUrl, fetch, throwOnError: true });
    this.#client = this.#rescope(accessToken);
    this.#workspace = workspace;
    this.#context = context ?? {
      credential: workspace === undefined ? "environment_token" : "profile",
      profile: workspace?.profile ?? null,
    };
    this.#commandPrefix = commandPrefix;
  }

  public actingAs(): IdentityReport["context"] {
    return this.#contextReport();
  }

  /** Which account this call acts as, without any credential. */
  #contextReport(): IdentityReport["context"] {
    const profile = this.#workspace?.profile ?? this.#context.profile;
    return {
      credential: this.#context.credential,
      profile: profile === null ? null : publicProfile(profile),
    };
  }

  /**
   * Bind this call's login, which has no organization yet, and continue with its new credential.
   * A login in another organization keeps it; the provider verifies the account first.
   */
  async #bind(
    organization: Parameters<typeof selectWorkspace>[1],
    signal: AbortSignal,
  ): Promise<LocalProfile> {
    const session = this.#interactiveSession();
    const bound = await selectWorkspace(session, organization, signal, (token) =>
      getCurrentIdentity({}, { client: this.#rescope(token) }),
    );
    const store = session.profiles.credential(bound);
    const credential = await store.read();
    if (credential === undefined) throw new InteractiveSessionRequiredError();
    this.#workspace = { ...session, store, profile: bound };
    this.#client = this.#rescope(credential.accessToken);
    return bound;
  }

  public async changeDatabaseCompute(input: {
    projectId: string;
    environment: "dev" | "prod";
    profile: "standard" | "performance";
    idempotencyKey: string;
  }) {
    return changeDatabaseCompute(
      {
        project_id: input.projectId,
        environment: input.environment,
        profile: input.profile,
        confirm: true,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
  }
  public async getDatabaseCompute(input: { projectId: string; environment: "dev" | "prod" }) {
    const value = await getDatabaseCompute(
      { project_id: input.projectId, environment: input.environment },
      { client: this.#client },
    );
    assertDatabaseCompute(value);
    if (value.project_id !== input.projectId || value.environment !== input.environment)
      throw new TypeError("Compute response scope mismatch");
    return value;
  }
  public async getProjectContext(projectId: string) {
    const result = await getProjectContext({ project_id: projectId }, { client: this.#client });
    assertProjectContext(result);
    if (result.project_id !== projectId) throw new TypeError("Project context scope mismatch");
    return result;
  }
  public async setProjectNotes(input: {
    projectId: string;
    markdown: string;
    expectedVersion: number;
    idempotencyKey: string;
  }) {
    const result = await setProjectNotes(
      {
        project_id: input.projectId,
        markdown: input.markdown,
        expected_version: input.expectedVersion,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
    assertProjectNotesReceipt(result);
    return result;
  }
  public async createProjectExport(
    input: Parameters<LocalMcpProductClient["createProjectExport"]>[0],
  ) {
    const password = await readExportPasswordFile(input.passwordFile);
    return createProjectExport(
      { project_id: input.projectId, password, "Idempotency-Key": input.idempotencyKey },
      { client: this.#client },
    );
  }
  public async getProjectExport(input: Parameters<LocalMcpProductClient["getProjectExport"]>[0]) {
    const result = await getProjectExport(
      { project_id: input.projectId, export_id: input.exportId },
      { client: this.#client },
    );
    assertProjectExport(result);
    return result;
  }
  public async createUserApiKey(input: Parameters<LocalMcpProductClient["createUserApiKey"]>[0]) {
    const file = await prepareUserTokenFile(input.outputPath);
    try {
      const result = await createUserApiKey(
        {
          organization_id: input.organizationId,
          name: input.name,
          "Idempotency-Key": input.idempotencyKey,
        },
        { client: this.#client },
      );
      return await file.save(result);
    } finally {
      await file.close();
    }
  }
  public async listUserApiKeys(input: Parameters<LocalMcpProductClient["listUserApiKeys"]>[0]) {
    return parseUserApiKeyPage(
      await listUserApiKeys(
        { organization_id: input.organizationId, ...(input.after ? { after: input.after } : {}) },
        { client: this.#client },
      ),
    );
  }
  public async revokeUserApiKey(input: Parameters<LocalMcpProductClient["revokeUserApiKey"]>[0]) {
    await revokeUserApiKey(
      { organization_id: input.organizationId, key_id: input.keyId },
      { client: this.#client },
    );
  }
  public async getCurrentIdentity(signal: AbortSignal): Promise<IdentityReport> {
    const identity = await getCurrentIdentity({}, { client: this.#client });
    // A session signed in before a workspace could be selected carries none, and then every
    // project call answers with an empty page that reads like an empty account.
    if (this.#workspace === undefined || parseCurrentIdentity(identity).organization_ids.length > 0)
      return { ...identity, context: this.#contextReport() };
    const selection = chooseWorkspace(await this.#readWorkspaces(), undefined);
    if (selection.outcome !== "selected") return { ...identity, context: this.#contextReport() };
    // The workspace lives in the access token, so the repaired identity needs the new one.
    await this.#bind(selection.organization, signal);
    return {
      ...(await getCurrentIdentity({}, { client: this.#client })),
      context: this.#contextReport(),
    };
  }
  public async changeProjectHandle(input: {
    projectId: string;
    handle: string;
    ifMatch: string;
    idempotencyKey: string;
  }) {
    return changeProjectHandle(
      {
        project_id: input.projectId,
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.ifMatch,
        handle: input.handle,
      },
      { client: this.#client },
    );
  }
  public async checkProjectHandle(input: { handle: string }) {
    return getProjectHandleAvailability({ handle: input.handle }, { client: this.#client });
  }
  public async planPaidDomain(input: { projectId: string; hostname: string }) {
    const value = await planPaidProjectDomain(
      { project_id: input.projectId, paidDomainRequest: { hostname: input.hostname } },
      { client: this.#client },
    );
    parsePaidDomainPlan(value);
    return value;
  }
  public async applyPaidDomain(input: {
    projectId: string;
    hostname: string;
    idempotencyKey: string;
  }) {
    const value = await applyPaidProjectDomain(
      {
        project_id: input.projectId,
        paidDomainRequest: { hostname: input.hostname },
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
    parsePaidDomain(value);
    return value;
  }
  public async getPaidDomain(projectId: string) {
    const value = await getPaidProjectDomain({ project_id: projectId }, { client: this.#client });
    parsePaidDomain(value);
    return value;
  }
  public async deletePaidDomain(input: {
    projectId: string;
    hostname: string;
    idempotencyKey: string;
  }) {
    const value = await deletePaidProjectDomain(
      {
        project_id: input.projectId,
        paidDomainRequest: { hostname: input.hostname },
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
    parsePaidDomain(value);
    return value;
  }
  public async getOrganizationAccount(organizationId: string) {
    const account = await getOrganizationAccount(
      { organization_id: organizationId },
      { client: this.#client },
    );
    assertOrganizationAccount(account);
    return account;
  }
  public async getOrganizationReferral(organizationId: string): Promise<OrganizationReferral> {
    return parseOrganizationReferral(
      await getOrganizationReferral({ organization_id: organizationId }, { client: this.#client }),
    );
  }
  public getOrganizationCredits(organizationId: string) {
    return getOrganizationCredits({ organization_id: organizationId }, { client: this.#client });
  }
  public async createBillingCheckout(
    input: Parameters<LocalMcpProductClient["createBillingCheckout"]>[0],
  ) {
    const value = await createBillingCheckout(
      {
        organization_id: input.organizationId,
        offer: input.offer,
        packs: input.packs,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
    assertBillingCheckout(value);
    return value;
  }
  public async getBillingCheckout(
    input: Parameters<LocalMcpProductClient["getBillingCheckout"]>[0],
  ) {
    const value = await getBillingCheckout(
      { organization_id: input.organizationId, checkout_id: input.checkoutId },
      { client: this.#client },
    );
    assertBillingCheckout(value);
    return value;
  }
  public async getBillingRecharge(organizationId: string) {
    const value = await getBillingRecharge(
      { organization_id: organizationId },
      { client: this.#client },
    );
    assertRecharge(value);
    return value;
  }
  public async configureBillingRecharge(
    input: Parameters<LocalMcpProductClient["configureBillingRecharge"]>[0],
  ) {
    const value = await configureBillingRecharge(
      {
        organization_id: input.organizationId,
        "Idempotency-Key": input.idempotencyKey,
        enabled: input.enabled,
        monthly_limit_minor: input.monthlyLimitMinor,
        consent: input.consent,
        revision: input.revision,
      },
      { client: this.#client },
    );
    assertRecharge(value);
    return value;
  }
  public async createBillingPortal(organizationId: string) {
    const value = await createBillingPortal(
      { organization_id: organizationId, body: {} },
      { client: this.#client },
    );
    assertBillingPortal(value);
    return value;
  }
  public async getOrganizationCreditUsage(
    input: Parameters<LocalMcpProductClient["getOrganizationCreditUsage"]>[0],
  ) {
    const value = await getOrganizationCreditUsage(
      {
        organization_id: input.organizationId,
        month: input.month,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
      { client: this.#client },
    );
    assertOrganizationCreditUsage(value);
    return value;
  }
  public getProjectCreditBudget(projectId: string) {
    return getProjectCreditBudget({ project_id: projectId }, { client: this.#client });
  }
  public setProjectCreditBudget(
    input: Parameters<LocalMcpProductClient["setProjectCreditBudget"]>[0],
  ) {
    return setProjectCreditBudget(
      {
        project_id: input.projectId,
        "Idempotency-Key": input.idempotencyKey,
        setProjectCreditBudgetRequest: { amount_micros: input.amountMicros, mode: input.mode },
      },
      { client: this.#client },
    );
  }
  public async createOrganization(
    input: Parameters<LocalMcpProductClient["createOrganization"]>[0],
    signal: AbortSignal,
  ): Promise<WorkspaceSelectionReport> {
    const created = await createOrganization(
      {
        "Idempotency-Key": input.idempotencyKey,
        createOrganizationRequest: {
          name: input.name,
          ...(input.signupSource === undefined ? {} : { signup_source: input.signupSource }),
        },
      },
      { client: this.#client },
    );
    const current = this.#interactiveSession().profile;
    // A login in another organization keeps it, so no other agent using it moves along; the new
    // workspace gets its own login instead.
    if (current.organizationId !== null && current.organizationId !== created.id)
      return {
        organization: { id: created.id, name: created.name },
        selected: current.organizationId,
        profile: publicProfile(current),
        next_action: `Run '${this.#commandPrefix} login --organization ${created.id} --user ${current.userId} --json' to add a login for the new workspace as the same user, then pass its profile_name.`,
      };
    // A created workspace only becomes usable once the access token carries it.
    return this.selectOrganization(created.id, signal);
  }

  public async listOrganizations(): Promise<WorkspaceReport> {
    const session = this.#interactiveSession();
    return {
      organizations: (await this.#readWorkspaces()).map(publicWorkspace),
      selected: session.profile.organizationId,
      profile: publicProfile(session.profile),
    };
  }

  public async selectOrganization(
    organizationId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceSelectionReport> {
    this.#interactiveSession();
    const selection = chooseWorkspace(await this.#readWorkspaces(), organizationId);
    if (selection.outcome !== "selected")
      throw new Error(`ORGANIZATION_NOT_FOUND:${organizationId}`);
    const profile = await this.#bind(selection.organization, signal);
    return {
      organization: publicWorkspace(selection.organization),
      selected: selection.organization.id,
      profile: publicProfile(profile),
    };
  }

  async #readWorkspaces() {
    this.#interactiveSession();
    return parseAccountProfile(await getAccountProfile({ client: this.#client })).organizations;
  }

  #interactiveSession(): WorkspaceSession {
    if (this.#workspace === undefined) throw new InteractiveSessionRequiredError();
    return this.#workspace;
  }
  public listProjects(input: Parameters<LocalMcpProductClient["listProjects"]>[0]) {
    return listProjects(
      {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      { client: this.#client },
    );
  }
  public getProject(projectId: string) {
    return getProject({ project_id: projectId }, { client: this.#client });
  }
  public async ensureDevShareLink(projectId: string): Promise<DevAccessState> {
    const result = parseDevAccessState(
      await ensureProjectDevShareLink({ project_id: projectId }, { client: this.#client }),
    );
    if (result.project_id !== projectId) throw new TypeError("Unexpected Dev share project");
    return result;
  }
  public async setDevAccessMode(input: {
    projectId: string;
    mode: "protected" | "public";
    idempotencyKey: string;
  }): Promise<DevAccessState> {
    return parseDevAccessState(
      await setProjectDevAccessMode(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          setDevAccessModeRequest: { mode: input.mode },
        },
        { client: this.#client },
      ),
    );
  }
  public async getPoweredByFlag(projectId: string): Promise<PoweredByFlag> {
    return parsePoweredByFlag(
      await getProjectPoweredByFlag({ project_id: projectId }, { client: this.#client }),
    );
  }
  public async setPoweredByFlag(input: {
    projectId: string;
    enabled: boolean;
    idempotencyKey: string;
  }): Promise<PoweredByFlag> {
    return parsePoweredByFlag(
      await setProjectPoweredByFlag(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          setPoweredByFlagRequest: { enabled: input.enabled },
        },
        { client: this.#client },
      ),
    );
  }
  public async rotateDevShareLink(input: {
    projectId: string;
    idempotencyKey: string;
  }): Promise<DevAccessState> {
    return parseDevAccessState(
      await rotateProjectDevShareLink(
        { project_id: input.projectId, "Idempotency-Key": input.idempotencyKey },
        { client: this.#client },
      ),
    );
  }
  public async revokeDevShareLink(input: {
    projectId: string;
    idempotencyKey: string;
  }): Promise<DevAccessState> {
    return parseDevAccessState(
      await revokeProjectDevShareLink(
        { project_id: input.projectId, "Idempotency-Key": input.idempotencyKey },
        { client: this.#client },
      ),
    );
  }
  public async createDevAccessTicket(projectId: string): Promise<DevAccessTicket> {
    const ticket = parseDevAccessTicket(
      await createProjectDevAccessTicket({ project_id: projectId }, { client: this.#client }),
    );
    if (ticket.project_id !== projectId) throw new TypeError("Unexpected Dev access project");
    return ticket;
  }
  public async authorizeCloudflareDns(
    input: Parameters<LocalMcpProductClient["authorizeCloudflareDns"]>[0],
  ): Promise<CloudflareDnsAuthorization> {
    return parseCloudflareDnsAuthorization(
      await createCloudflareDnsAuthorization(
        {
          project_id: input.projectId,
          createCloudflareDnsAuthorizationRequest: { zone: input.zone },
          "Idempotency-Key": input.idempotencyKey,
        },
        { client: this.#client },
      ),
    );
  }
  public async getCloudflareDnsStatus(
    projectId: string,
  ): Promise<CloudflareDnsAuthorizationStatus> {
    const status = parseCloudflareDnsAuthorizationStatus(
      await getCloudflareDnsAuthorizationStatus(
        { project_id: projectId },
        { client: this.#client },
      ),
    );
    return { ...status, scopes: [...status.scopes] };
  }
  public getProjectStatus(projectId: string) {
    return getProjectStatus({ project_id: projectId }, { client: this.#client });
  }
  public async writeDatabase(input: Parameters<LocalMcpProductClient["writeDatabase"]>[0]) {
    const value = await writeProjectDatabase(
      {
        project_id: input.projectId,
        "Idempotency-Key": input.idempotencyKey,
        projectDatabaseWriteRequest: {
          environment: input.environment,
          statement: input.statement,
          parameters: [...input.parameters],
        },
      },
      { client: this.#client },
    );
    assertProjectDatabaseWriteReceipt(value);
    return value;
  }
  public queryDatabase(input: Parameters<LocalMcpProductClient["queryDatabase"]>[0]) {
    return queryProjectDatabase(
      {
        project_id: input.projectId,
        projectDatabaseQueryRequest: {
          environment: input.environment,
          statement: input.statement,
          parameters: [...input.parameters],
        },
      },
      { client: this.#client },
    );
  }
  /** The connection URI exists only in this response and is never stored by the client. */
  public async createDatabaseAccess(
    input: Parameters<LocalMcpProductClient["createDatabaseAccess"]>[0],
  ) {
    const value = await createProjectDatabaseAccess(
      {
        project_id: input.projectId,
        projectDatabaseAccessRequest: {
          environment: input.environment,
          mode: input.mode,
          ttl_seconds: input.ttlSeconds,
          label: input.label,
        },
      },
      { client: this.#client },
    );
    assertProjectDatabaseAccessCredential(value);
    return value;
  }
  public async listDatabaseAccess(
    input: Parameters<LocalMcpProductClient["listDatabaseAccess"]>[0],
  ) {
    const value = await listProjectDatabaseAccess(
      {
        project_id: input.projectId,
        ...(input.environment === undefined ? {} : { environment: input.environment }),
      },
      { client: this.#client },
    );
    assertProjectDatabaseAccessPage(value);
    return value;
  }
  public async revokeDatabaseAccess(
    input: Parameters<LocalMcpProductClient["revokeDatabaseAccess"]>[0],
  ) {
    const value = await revokeProjectDatabaseAccess(
      { project_id: input.projectId, access_id: input.accessId },
      { client: this.#client },
    );
    assertProjectDatabaseAccess(value);
    return value;
  }
  public planPromotion(input: Parameters<LocalMcpProductClient["planPromotion"]>[0]) {
    return planDeploymentPromotion(
      { project_id: input.projectId, source_deployment_id: input.sourceDeploymentId },
      { client: this.#client },
    );
  }
  public promote(input: Parameters<LocalMcpProductClient["promote"]>[0]) {
    return promoteDeployment(
      {
        project_id: input.projectId,
        source_deployment_id: input.sourceDeploymentId,
        "If-Match": input.ifMatch,
        "X-Confirmation-Token": input.confirmationToken,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
  }
  public getSource(projectId: string) {
    return getProjectSource({ project_id: projectId }, { client: this.#client });
  }
  public async getOperation(operationId: string): Promise<Operation> {
    return parseOperation(
      await getOperation({ operation_id: operationId }, { client: this.#client }),
    );
  }
  public reconcileOperation(input: Parameters<LocalMcpProductClient["reconcileOperation"]>[0]) {
    return reconcileOperation(
      {
        "Idempotency-Key": input.idempotencyKey,
        operation_id: input.operationId,
      },
      { client: this.#client },
    );
  }
  public managedMail(input: ManagedMailCommand) {
    return executeManagedMail(this.#client, input);
  }
  public planDelete(projectId: string) {
    return planProjectDeletion({ project_id: projectId }, { client: this.#client });
  }

  public async submitFeedback(input: {
    report: import("@ohmyhost/sdk-ts").FeedbackSubmission;
    idempotencyKey: string;
  }): Promise<import("@ohmyhost/sdk-ts").FeedbackReceipt> {
    return parseFeedbackReceipt(
      await submitFeedback(
        { "Idempotency-Key": input.idempotencyKey, feedbackSubmission: input.report },
        { client: this.#client },
      ),
    );
  }

  public async getFeedback(
    feedbackId: string,
    cursor?: string,
  ): Promise<import("@ohmyhost/sdk-ts").FeedbackStatus> {
    return parseFeedbackStatus(
      await getFeedback(
        { feedback_id: feedbackId, ...(cursor === undefined ? {} : { cursor }) },
        { client: this.#client },
      ),
    ) as import("@ohmyhost/sdk-ts").FeedbackStatus;
  }

  public createProject(input: Parameters<LocalMcpProductClient["createProject"]>[0]) {
    return createProject(
      {
        "Idempotency-Key": input.idempotencyKey,
        createProjectRequest: {
          organization_id: input.organizationId,
          name: input.name,
          ...(input.dataMode === undefined ? {} : { data_mode: input.dataMode }),
          ...(input.devAccessMode === undefined ? {} : { dev_access_mode: input.devAccessMode }),
          ...(input.region === undefined ? {} : { region: input.region }),
        },
      },
      { client: this.#client },
    );
  }

  public connectGithub(input: Parameters<LocalMcpProductClient["connectGithub"]>[0]) {
    return connectGithubOrganization(
      {
        organization_id: input.organizationId,
        "Idempotency-Key": input.idempotencyKey,
        connectGithubOrganizationRequest: {},
      },
      { client: this.#client },
    );
  }

  public getGithubConnection(organizationId: string) {
    return getGithubOrganizationConnection(
      { organization_id: organizationId },
      { client: this.#client },
    );
  }

  public linkSource(input: Parameters<LocalMcpProductClient["linkSource"]>[0]) {
    return linkProjectSource(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        linkProjectSourceRequest: {
          repository_owner: input.repositoryOwner,
          repository_name: input.repositoryName,
        },
      },
      { client: this.#client },
    );
  }

  public planDeployment(input: Parameters<LocalMcpProductClient["planDeployment"]>[0]) {
    return planDeployment(
      {
        project_id: input.projectId,
        planDeploymentRequest: { commit_sha: input.commitSha, environment: input.environment },
      },
      { client: this.#client },
    );
  }

  public createDeployment(input: Parameters<LocalMcpProductClient["createDeployment"]>[0]) {
    return createDeployment(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        createDeploymentRequest: { plan_id: input.planId },
      },
      { client: this.#client },
    );
  }

  public listDeployments(input: Parameters<LocalMcpProductClient["listDeployments"]>[0]) {
    return listDeployments(
      {
        project_id: input.projectId,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      { client: this.#client },
    );
  }

  public getDeployment(input: Parameters<LocalMcpProductClient["getDeployment"]>[0]) {
    return getDeployment(
      { project_id: input.projectId, deployment_id: input.deploymentId },
      { client: this.#client },
    );
  }

  public async listOperationEvents(
    operationId: string,
    signal: AbortSignal,
    maxEvents: number,
  ): Promise<readonly OperationEvent[]> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let streamFailed = false;
    try {
      const result = await streamOperationEvents(
        { operation_id: operationId },
        {
          client: this.#client,
          signal: controller.signal,
          sseMaxRetryAttempts: 1,
          onSseError: () => {
            if (!controller.signal.aborted) streamFailed = true;
          },
          headers: { Accept: "text/event-stream" },
        },
      );
      const events: OperationEvent[] = [];
      for await (const event of result.stream) {
        events.push(event);
        if (
          events.length >= maxEvents ||
          ["OperationSucceeded", "OperationFailed", "OperationCancelled"].includes(event.type)
        ) {
          controller.abort();
          break;
        }
      }
      if (streamFailed || events.length === 0) throw new OperationEventsUnavailableError();
      return events;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener("abort", abort);
    }
  }

  public listEnvironmentSecrets(
    input: Parameters<LocalMcpProductClient["listEnvironmentSecrets"]>[0],
  ) {
    return listEnvironmentSecrets(
      { project_id: input.projectId, environment_id: input.environmentId },
      { client: this.#client },
    );
  }

  public getDeploymentLogs(input: Parameters<LocalMcpProductClient["getDeploymentLogs"]>[0]) {
    return getDeploymentLogs(
      { project_id: input.projectId, deployment_id: input.deploymentId, limit: input.limit },
      { client: this.#client },
    );
  }

  public listFunctionRuns(input: Parameters<LocalMcpProductClient["listFunctionRuns"]>[0]) {
    return listFunctionRuns(
      { project_id: input.projectId, environment_id: input.environmentId, limit: input.limit },
      { client: this.#client },
    );
  }

  public deleteEnvironmentSecret(
    input: Parameters<LocalMcpProductClient["deleteEnvironmentSecret"]>[0],
  ) {
    return deleteEnvironmentSecret(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        environment_id: input.environmentId,
        secret_name: input.name,
      },
      { client: this.#client },
    );
  }

  public planRollback(input: Parameters<LocalMcpProductClient["planRollback"]>[0]) {
    return planDeploymentRollback(
      { project_id: input.projectId, target_deployment_id: input.deploymentId },
      { client: this.#client },
    );
  }

  public rollback(input: Parameters<LocalMcpProductClient["rollback"]>[0]) {
    return rollbackDeployment(
      {
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.ifMatch,
        "X-Confirmation-Token": input.confirmationToken,
        project_id: input.projectId,
        target_deployment_id: input.deploymentId,
      },
      { client: this.#client },
    );
  }

  public deleteProject(input: Parameters<LocalMcpProductClient["deleteProject"]>[0]) {
    return deleteProject(
      {
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.ifMatch,
        "X-Confirmation-Token": input.confirmationToken,
        project_id: input.projectId,
      },
      { client: this.#client },
    );
  }
}

/** User-controlled password input only; no writes or credential persistence. */
async function readExportPasswordFile(path: string): Promise<string> {
  const buffer = Buffer.alloc(1025);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!isAbsolute(path)) throw new Error();
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 1 ||
      before.size > 1024 ||
      (process.platform !== "win32" && (before.mode & 0o077) !== 0)
    )
      throw new Error();
    file = await open(path, "r");
    const after = await file.stat();
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size)
      throw new Error();
    const read = await file.read(buffer, 0, 1025, 0);
    if (read.bytesRead < 1 || read.bytesRead > 1024) throw new Error();
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, read.bytesRead),
    );
    if (!value.trim()) throw new Error();
    return value;
  } catch {
    throw new Error(
      "EXPORT_PASSWORD_FILE_INVALID: Choose an existing private UTF-8 password file of 1–1024 bytes.",
    );
  } finally {
    buffer.fill(0);
    await file?.close();
  }
}
