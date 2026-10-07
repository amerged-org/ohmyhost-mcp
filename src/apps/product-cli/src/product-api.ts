import { executeManagedMail, type ManagedMailCommand } from "@ohmyhost/sdk-ts";
import type {
  ProjectDataChangeKind,
  ProjectDataChangePlan,
} from "@ohmyhost/contracts/project-data-changes";
import {
  assertProjectDatabaseAccess,
  assertProjectDatabaseAccessCredential,
  assertProjectDatabaseAccessPage,
  type DatabaseAccessMode,
  type ProjectDatabaseAccess,
  type ProjectDatabaseAccessCredential,
  type ProjectDatabaseAccessPage,
  type ProjectDatabaseWriteRequest,
  type ProjectDatabaseWriteReceipt,
} from "@ohmyhost/contracts/database-access";
import { assertDatabaseCompute, type DatabaseCompute } from "@ohmyhost/contracts/database-compute";
import {
  assertProjectContext,
  assertProjectNotesReceipt,
  type ProjectContext,
  type ProjectNotesReceipt,
} from "@ohmyhost/contracts/project-context";
import { assertProjectExport, type ProjectExport } from "@ohmyhost/contracts/project-exports";
import {
  parseUserApiKeyCreation,
  parseUserApiKeyPage,
  type UserApiKeyCreation,
  type UserApiKeyPage,
} from "@ohmyhost/contracts/user-api-keys";
import { parseFeedbackReceipt, parseFeedbackStatus } from "@ohmyhost/contracts/feedback";
import {
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
  type BillingCheckout,
  type BillingPortal,
  getOrganizationCredits,
  getOrganizationAccount,
  getOrganizationReferral,
  type OrganizationAccount,
  getOrganizationCreditUsage,
  type OrganizationCreditUsage,
  getProjectCreditBudget,
  setProjectCreditBudget,
  type OrganizationCredits,
  type ProjectCreditBudget,
  applyPaidProjectDomain,
  configureProjectDomains,
  configureProjectSourceAutoDeploy,
  createCloudflareDnsAuthorization,
  createProjectDevAccessTicket,
  ensureProjectDevShareLink,
  rotateProjectDevShareLink,
  revokeProjectDevShareLink,
  setProjectDevAccessMode,
  getProjectPoweredByFlag,
  setProjectPoweredByFlag,
  createDeployment,
  createProject,
  planProjectDataChange,
  createProjectDataChange,
  submitFeedback,
  getFeedback,
  createOrganization,
  type Organization,
  type GithubConnectionAuthorization,
  type GithubOrganizationConnectionStatus,
  connectGithubOrganization,
  getGithubOrganizationConnection,
  deleteEnvironmentSecret,
  deleteProject,
  deletePaidProjectDomain,
  getOperation,
  getCloudflareDnsAuthorizationStatus,
  getAccountProfile,
  getCurrentIdentity,
  getDeployment,
  getProjectSourceAutoDeploy,
  getProjectStatus,
  getPaidProjectDomain,
  getDeploymentLogs,
  linkProjectSource,
  listEnvironmentSecrets,
  listFunctionRuns,
  listProjects,
  changeProjectHandle,
  getProjectHandleAvailability,
  planDeployment,
  planPaidProjectDomain,
  planDeploymentRollback,
  planDeploymentPromotion,
  promoteDeployment,
  planProjectDeletion,
  rollbackDeployment,
  putEnvironmentSecret,
  queryProjectDatabase,
  writeProjectDatabase,
  createProjectDatabaseAccess,
  listProjectDatabaseAccess,
  revokeProjectDatabaseAccess,
  reconcileOperation,
  streamOperationEvents,
  type DeploymentPlan,
  type CloudflareDnsAuthorization,
  type CloudflareDnsAuthorizationStatus,
  type GuardedActionPlan,
  type Operation,
  type OperationEvent,
  type EnvironmentSecret,
  type EnvironmentSecretPage,
  type FunctionRunPage,
  type DeleteEnvironmentSecretResult,
  type OhMyHostClient,
  type ProviderReconciliationAttempt,
  type CurrentIdentity,
  type DevAccessTicket,
  type ProjectPage,
  type ProjectHandleAvailability,
  type ProjectStatus,
  type PaidDomain,
  type PaidDomainPlan,
  type ProjectDatabaseQueryResult,
  type DeploymentDiagnosticPage,
  type Deployment,
  type SourceAutoDeploy,
} from "@ohmyhost/sdk-ts";
import {
  parseAccountProfile,
  parseProjectDataChangePlan,
  parseOperation,
  type PublicAccount,
} from "./runtime-contract.js";
import { GeneratedSdkManagedSourceApi } from "./source-managed-client.js";
import type { ManagedSourceApi } from "./source-publisher.js";

export interface ProjectCreateInput {
  readonly organizationId: string;
  readonly name: string;
  readonly dataMode?: "shared" | "isolated";
  readonly devAccessMode?: "protected" | "public";
  readonly region?: "us" | "eu";
  readonly idempotencyKey: string;
}

export interface ProductApi {
  readonly managedSource?: ManagedSourceApi;
  planProjectDataChange(input: {
    projectId: string;
    change: ProjectDataChangeKind;
  }): Promise<ProjectDataChangePlan>;
  createProjectDataChange(input: {
    projectId: string;
    change: ProjectDataChangeKind;
    ifMatch: string;
    confirmationToken: string;
    idempotencyKey: string;
  }): Promise<Operation>;
  changeDatabaseCompute(input: {
    projectId: string;
    environment: "dev" | "prod";
    profile: "standard" | "performance";
    idempotencyKey: string;
  }): Promise<import("@ohmyhost/sdk-ts").Operation>;
  getDatabaseCompute(input: {
    projectId: string;
    environment: "dev" | "prod";
  }): Promise<DatabaseCompute>;
  getProjectContext(projectId: string): Promise<ProjectContext>;
  setProjectNotes(input: {
    projectId: string;
    markdown: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<ProjectNotesReceipt>;
  createProjectExport(input: {
    projectId: string;
    password: string;
    idempotencyKey: string;
  }): Promise<Operation>;
  getProjectExport(input: { projectId: string; exportId: string }): Promise<ProjectExport>;
  createUserApiKey(input: {
    organizationId: string;
    name: string;
    idempotencyKey: string;
  }): Promise<UserApiKeyCreation>;
  listUserApiKeys(input: { organizationId: string; after?: string }): Promise<UserApiKeyPage>;
  revokeUserApiKey(input: { organizationId: string; keyId: string }): Promise<void>;
  createBillingCheckout(input: {
    organizationId: string;
    offer: "topup" | "paid";
    packs: number;
    idempotencyKey: string;
  }): Promise<BillingCheckout>;
  getBillingCheckout(input: {
    organizationId: string;
    checkoutId: string;
  }): Promise<BillingCheckout>;
  getBillingRecharge(organizationId: string): Promise<import("@ohmyhost/sdk-ts").BillingRecharge>;
  configureBillingRecharge(input: {
    organizationId: string;
    enabled: boolean;
    monthlyLimitMinor: number;
    consent: "off_session_v1" | null;
    revision: number;
    idempotencyKey: string;
  }): Promise<import("@ohmyhost/sdk-ts").BillingRecharge>;
  createBillingPortal(organizationId: string): Promise<BillingPortal>;
  getOrganizationAccount(organizationId: string): Promise<OrganizationAccount>;
  getOrganizationReferral(
    organizationId: string,
  ): Promise<import("@ohmyhost/sdk-ts").OrganizationReferral>;
  getOrganizationCredits(organizationId: string): Promise<OrganizationCredits>;
  getOrganizationCreditUsage(input: {
    organizationId: string;
    month: string;
    cursor?: string;
  }): Promise<OrganizationCreditUsage>;
  getProjectCreditBudget(projectId: string): Promise<ProjectCreditBudget>;
  setProjectCreditBudget(input: {
    projectId: string;
    amountMicros: string | null;
    mode: "continue" | "stop";
    idempotencyKey: string;
  }): Promise<ProjectCreditBudget>;
  createOrganization(input: {
    readonly name: string;
    readonly signupSource?: string;
    readonly idempotencyKey: string;
  }): Promise<Organization>;
  getCurrentIdentity(): Promise<CurrentIdentity>;
  /** The signed-in user and its workspaces; an interactive session is required for this route. */
  getAccountProfile(): Promise<PublicAccount>;
  listProjects(input: { readonly cursor?: string; readonly limit: number }): Promise<ProjectPage>;
  checkProjectHandle(input: { readonly handle: string }): Promise<ProjectHandleAvailability>;
  changeProjectHandle(input: {
    readonly projectId: string;
    readonly handle: string;
    readonly ifMatch: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  getProjectStatus(projectId: string): Promise<ProjectStatus>;
  writeProjectDatabase(
    input: ProjectDatabaseWriteRequest & { projectId: string; idempotencyKey: string },
  ): Promise<ProjectDatabaseWriteReceipt>;
  queryProjectDatabase(input: {
    readonly environment: "dev" | "prod";
    readonly projectId: string;
    readonly statement: string;
    readonly parameters: readonly (string | number | boolean | null)[];
  }): Promise<ProjectDatabaseQueryResult>;
  createProjectDatabaseAccess(input: {
    readonly projectId: string;
    readonly environment: "dev" | "prod";
    readonly mode: DatabaseAccessMode;
    readonly ttlSeconds: number;
    readonly label: string | null;
  }): Promise<ProjectDatabaseAccessCredential>;
  listProjectDatabaseAccess(input: {
    readonly projectId: string;
    readonly environment?: "dev" | "prod";
  }): Promise<ProjectDatabaseAccessPage>;
  revokeProjectDatabaseAccess(input: {
    readonly projectId: string;
    readonly accessId: string;
  }): Promise<ProjectDatabaseAccess>;
  planPaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
  }): Promise<PaidDomainPlan>;
  applyPaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
    readonly idempotencyKey: string;
  }): Promise<PaidDomain>;
  getPaidDomain(projectId: string): Promise<PaidDomain>;
  deletePaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
    readonly idempotencyKey: string;
  }): Promise<PaidDomain>;
  createDevAccessTicket(projectId: string): Promise<DevAccessTicket>;
  ensureDevShareLink(projectId: string): Promise<import("@ohmyhost/sdk-ts").DevAccessState>;
  rotateDevShareLink(
    projectId: string,
    idempotencyKey: string,
  ): Promise<import("@ohmyhost/sdk-ts").DevAccessState>;
  revokeDevShareLink(
    projectId: string,
    idempotencyKey: string,
  ): Promise<import("@ohmyhost/sdk-ts").DevAccessState>;
  setDevAccessMode(
    projectId: string,
    mode: "protected" | "public",
    idempotencyKey: string,
  ): Promise<import("@ohmyhost/sdk-ts").DevAccessState>;
  getPoweredByFlag(projectId: string): Promise<import("@ohmyhost/sdk-ts").PoweredByFlag>;
  setPoweredByFlag(
    projectId: string,
    enabled: boolean,
    idempotencyKey: string,
  ): Promise<import("@ohmyhost/sdk-ts").PoweredByFlag>;
  submitFeedback(input: {
    report: import("@ohmyhost/sdk-ts").FeedbackSubmission;
    idempotencyKey: string;
  }): Promise<import("@ohmyhost/sdk-ts").FeedbackReceipt>;
  getFeedback(
    feedbackId: string,
    cursor?: string,
  ): Promise<import("@ohmyhost/sdk-ts").FeedbackStatus>;
  createProject(input: ProjectCreateInput): Promise<Operation>;
  getOperation(operationId: string): Promise<Operation>;
  reconcileOperation(input: {
    readonly operationId: string;
    readonly idempotencyKey: string;
  }): Promise<ProviderReconciliationAttempt>;
  connectGithub(input: {
    readonly organizationId: string;
    readonly idempotencyKey: string;
  }): Promise<GithubConnectionAuthorization>;
  getGithubConnection(organizationId: string): Promise<GithubOrganizationConnectionStatus>;
  linkSource(input: {
    readonly projectId: string;
    readonly repositoryOwner: string;
    readonly repositoryName: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  configureAutoDeploy(input: {
    readonly projectId: string;
    readonly branch: string;
    readonly enabled: boolean;
    readonly idempotencyKey: string;
  }): Promise<SourceAutoDeploy>;
  getAutoDeploy(projectId: string): Promise<SourceAutoDeploy>;
  authorizeCloudflareDns(input: {
    readonly projectId: string;
    readonly zone: string;
    readonly idempotencyKey: string;
  }): Promise<CloudflareDnsAuthorization>;
  getCloudflareDnsStatus(projectId: string): Promise<CloudflareDnsAuthorizationStatus>;
  applyProjectDomains(input: {
    readonly projectId: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  planDeployment(input: {
    readonly projectId: string;
    readonly commitSha: string;
    readonly environment: "dev" | "prod";
  }): Promise<DeploymentPlan>;
  createDeployment(input: {
    readonly projectId: string;
    readonly planId: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  getDeployment(input: {
    readonly projectId: string;
    readonly deploymentId: string;
  }): Promise<Deployment>;
  /**
   * One connection to the operation's events, resumed after `lastEventId` when given. It ends,
   * without retrying, when the server closes it or refuses it; the caller decides what follows.
   */
  streamOperationEvents(
    operationId: string,
    signal: AbortSignal,
    lastEventId?: string,
  ): Promise<AsyncIterable<OperationEvent>>;
  getDeploymentLogs(input: {
    readonly projectId: string;
    readonly deploymentId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<DeploymentDiagnosticPage>;
  planRollback(input: {
    readonly projectId: string;
    readonly deploymentId: string;
  }): Promise<GuardedActionPlan>;
  rollback(input: {
    readonly projectId: string;
    readonly deploymentId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  planPromotion(input: {
    readonly projectId: string;
    readonly sourceDeploymentId: string;
  }): Promise<GuardedActionPlan>;
  promote(input: {
    readonly projectId: string;
    readonly sourceDeploymentId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  planDelete(projectId: string): Promise<GuardedActionPlan>;
  deleteProject(input: {
    readonly projectId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation>;
  listEnvironmentSecrets(input: {
    readonly projectId: string;
    readonly environmentId: string;
  }): Promise<EnvironmentSecretPage>;
  listFunctionRuns(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly limit: number;
  }): Promise<FunctionRunPage>;
  putEnvironmentSecret(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly name: string;
    readonly value: string;
    readonly idempotencyKey: string;
  }): Promise<EnvironmentSecret>;
  deleteEnvironmentSecret(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly name: string;
    readonly idempotencyKey: string;
  }): Promise<DeleteEnvironmentSecretResult>;
  managedMail?(input: ManagedMailCommand): Promise<unknown>;
}

export class GeneratedSdkProductApi implements ProductApi {
  readonly #client: OhMyHostClient;
  public readonly managedSource: ManagedSourceApi;

  public constructor(
    baseUrl: string,
    accessToken: string | (() => Promise<string>),
    fetch: typeof globalThis.fetch,
  ) {
    this.#client = createClient({ auth: accessToken, baseUrl, fetch, throwOnError: true });
    this.managedSource = new GeneratedSdkManagedSourceApi(() => this.#client);
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
  public createProjectExport(input: Parameters<ProductApi["createProjectExport"]>[0]) {
    return createProjectExport(
      {
        project_id: input.projectId,
        password: input.password,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
  }
  public async getProjectExport(input: Parameters<ProductApi["getProjectExport"]>[0]) {
    const result = await getProjectExport(
      { project_id: input.projectId, export_id: input.exportId },
      { client: this.#client },
    );
    assertProjectExport(result);
    return result;
  }
  public async getCurrentIdentity(): Promise<CurrentIdentity> {
    return getCurrentIdentity({}, { client: this.#client });
  }

  public async getAccountProfile(): Promise<PublicAccount> {
    return parseAccountProfile(await getAccountProfile({ client: this.#client }));
  }

  public getOrganizationReferral(organizationId: string) {
    return getOrganizationReferral({ organization_id: organizationId }, { client: this.#client });
  }
  public getOrganizationAccount(organizationId: string) {
    return getOrganizationAccount({ organization_id: organizationId }, { client: this.#client });
  }
  public getOrganizationCredits(organizationId: string) {
    return getOrganizationCredits({ organization_id: organizationId }, { client: this.#client });
  }
  public async createUserApiKey(input: Parameters<ProductApi["createUserApiKey"]>[0]) {
    return parseUserApiKeyCreation(
      await createUserApiKey(
        {
          organization_id: input.organizationId,
          name: input.name,
          "Idempotency-Key": input.idempotencyKey,
        },
        { client: this.#client },
      ),
    );
  }
  public async listUserApiKeys(input: Parameters<ProductApi["listUserApiKeys"]>[0]) {
    return parseUserApiKeyPage(
      await listUserApiKeys(
        { organization_id: input.organizationId, ...(input.after ? { after: input.after } : {}) },
        { client: this.#client },
      ),
    );
  }
  public async revokeUserApiKey(input: Parameters<ProductApi["revokeUserApiKey"]>[0]) {
    await revokeUserApiKey(
      { organization_id: input.organizationId, key_id: input.keyId },
      { client: this.#client },
    );
  }
  public createBillingCheckout(input: Parameters<ProductApi["createBillingCheckout"]>[0]) {
    return createBillingCheckout(
      {
        organization_id: input.organizationId,
        offer: input.offer,
        packs: input.packs,
        "Idempotency-Key": input.idempotencyKey,
      },
      { client: this.#client },
    );
  }
  public getBillingCheckout(input: Parameters<ProductApi["getBillingCheckout"]>[0]) {
    return getBillingCheckout(
      { organization_id: input.organizationId, checkout_id: input.checkoutId },
      { client: this.#client },
    );
  }
  public getBillingRecharge(organizationId: string) {
    return getBillingRecharge({ organization_id: organizationId }, { client: this.#client });
  }
  public configureBillingRecharge(input: Parameters<ProductApi["configureBillingRecharge"]>[0]) {
    return configureBillingRecharge(
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
  }
  public createBillingPortal(organizationId: string) {
    return createBillingPortal(
      { organization_id: organizationId, body: {} },
      { client: this.#client },
    );
  }
  public getOrganizationCreditUsage(
    input: Parameters<ProductApi["getOrganizationCreditUsage"]>[0],
  ) {
    return getOrganizationCreditUsage(
      {
        organization_id: input.organizationId,
        month: input.month,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
      { client: this.#client },
    );
  }
  public getProjectCreditBudget(projectId: string) {
    return getProjectCreditBudget({ project_id: projectId }, { client: this.#client });
  }
  public setProjectCreditBudget(input: Parameters<ProductApi["setProjectCreditBudget"]>[0]) {
    return setProjectCreditBudget(
      {
        project_id: input.projectId,
        "Idempotency-Key": input.idempotencyKey,
        setProjectCreditBudgetRequest: { amount_micros: input.amountMicros, mode: input.mode },
      },
      { client: this.#client },
    );
  }

  public createOrganization(input: {
    readonly name: string;
    readonly signupSource?: string;
    readonly idempotencyKey: string;
  }): Promise<Organization> {
    return createOrganization(
      {
        "Idempotency-Key": input.idempotencyKey,
        createOrganizationRequest: {
          name: input.name,
          ...(input.signupSource === undefined ? {} : { signup_source: input.signupSource }),
        },
      },
      { client: this.#client },
    );
  }

  public async listProjects(input: {
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<ProjectPage> {
    return listProjects(input, { client: this.#client });
  }

  public async changeProjectHandle(input: {
    readonly projectId: string;
    readonly handle: string;
    readonly ifMatch: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
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

  public async checkProjectHandle(input: {
    readonly handle: string;
  }): Promise<ProjectHandleAvailability> {
    return getProjectHandleAvailability({ handle: input.handle }, { client: this.#client });
  }

  public async getProjectStatus(projectId: string): Promise<ProjectStatus> {
    return getProjectStatus({ project_id: projectId }, { client: this.#client });
  }

  public async writeProjectDatabase(
    input: ProjectDatabaseWriteRequest & { projectId: string; idempotencyKey: string },
  ): Promise<ProjectDatabaseWriteReceipt> {
    return writeProjectDatabase(
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
  }
  public async queryProjectDatabase(input: {
    readonly environment: "dev" | "prod";
    readonly projectId: string;
    readonly statement: string;
    readonly parameters: readonly (string | number | boolean | null)[];
  }): Promise<ProjectDatabaseQueryResult> {
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

  /** The connection URI exists only in this response; nothing in the CLI persists it. */
  public async createProjectDatabaseAccess(
    input: Parameters<ProductApi["createProjectDatabaseAccess"]>[0],
  ): Promise<ProjectDatabaseAccessCredential> {
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

  public async listProjectDatabaseAccess(
    input: Parameters<ProductApi["listProjectDatabaseAccess"]>[0],
  ): Promise<ProjectDatabaseAccessPage> {
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

  public async revokeProjectDatabaseAccess(
    input: Parameters<ProductApi["revokeProjectDatabaseAccess"]>[0],
  ): Promise<ProjectDatabaseAccess> {
    const value = await revokeProjectDatabaseAccess(
      { project_id: input.projectId, access_id: input.accessId },
      { client: this.#client },
    );
    assertProjectDatabaseAccess(value);
    return value;
  }

  public async planPaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
  }): Promise<PaidDomainPlan> {
    return planPaidProjectDomain(
      { project_id: input.projectId, paidDomainRequest: { hostname: input.hostname } },
      { client: this.#client },
    );
  }

  public async applyPaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
    readonly idempotencyKey: string;
  }): Promise<PaidDomain> {
    return applyPaidProjectDomain(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        paidDomainRequest: { hostname: input.hostname },
      },
      { client: this.#client },
    );
  }

  public async getPaidDomain(projectId: string): Promise<PaidDomain> {
    return getPaidProjectDomain({ project_id: projectId }, { client: this.#client });
  }

  public async deletePaidDomain(input: {
    readonly projectId: string;
    readonly hostname: string;
    readonly idempotencyKey: string;
  }): Promise<PaidDomain> {
    return deletePaidProjectDomain(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        paidDomainRequest: { hostname: input.hostname },
      },
      { client: this.#client },
    );
  }

  public async ensureDevShareLink(projectId: string) {
    return ensureProjectDevShareLink({ project_id: projectId }, { client: this.#client });
  }
  public async rotateDevShareLink(projectId: string, idempotencyKey: string) {
    return rotateProjectDevShareLink(
      { project_id: projectId, "Idempotency-Key": idempotencyKey },
      { client: this.#client },
    );
  }
  public async revokeDevShareLink(projectId: string, idempotencyKey: string) {
    return revokeProjectDevShareLink(
      { project_id: projectId, "Idempotency-Key": idempotencyKey },
      { client: this.#client },
    );
  }
  public async setDevAccessMode(
    projectId: string,
    mode: "protected" | "public",
    idempotencyKey: string,
  ) {
    return setProjectDevAccessMode(
      {
        project_id: projectId,
        "Idempotency-Key": idempotencyKey,
        setDevAccessModeRequest: { mode },
      },
      { client: this.#client },
    );
  }
  public async getPoweredByFlag(projectId: string) {
    return getProjectPoweredByFlag({ project_id: projectId }, { client: this.#client });
  }
  public async setPoweredByFlag(projectId: string, enabled: boolean, idempotencyKey: string) {
    return setProjectPoweredByFlag(
      {
        project_id: projectId,
        "Idempotency-Key": idempotencyKey,
        setPoweredByFlagRequest: { enabled },
      },
      { client: this.#client },
    );
  }
  public async createDevAccessTicket(projectId: string): Promise<DevAccessTicket> {
    return createProjectDevAccessTicket({ project_id: projectId }, { client: this.#client });
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

  public async planProjectDataChange(
    input: Parameters<ProductApi["planProjectDataChange"]>[0],
  ): Promise<ProjectDataChangePlan> {
    return parseProjectDataChangePlan(
      await planProjectDataChange(
        { project_id: input.projectId, projectDataChangeRequest: { change: input.change } },
        { client: this.#client },
      ),
    );
  }
  public async createProjectDataChange(
    input: Parameters<ProductApi["createProjectDataChange"]>[0],
  ): Promise<Operation> {
    return parseOperation(
      await createProjectDataChange(
        {
          project_id: input.projectId,
          projectDataChangeRequest: { change: input.change },
          "If-Match": input.ifMatch,
          "X-Confirmation-Token": input.confirmationToken,
          "Idempotency-Key": input.idempotencyKey,
        },
        { client: this.#client },
      ),
    );
  }
  public async createProject(input: ProjectCreateInput): Promise<Operation> {
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

  public async getOperation(operationId: string): Promise<Operation> {
    return getOperation({ operation_id: operationId }, { client: this.#client });
  }

  public async reconcileOperation(input: {
    readonly operationId: string;
    readonly idempotencyKey: string;
  }): Promise<ProviderReconciliationAttempt> {
    return reconcileOperation(
      {
        "Idempotency-Key": input.idempotencyKey,
        operation_id: input.operationId,
      },
      { client: this.#client },
    );
  }

  public async connectGithub(input: {
    readonly organizationId: string;
    readonly idempotencyKey: string;
  }): Promise<GithubConnectionAuthorization> {
    return connectGithubOrganization(
      {
        organization_id: input.organizationId,
        "Idempotency-Key": input.idempotencyKey,
        connectGithubOrganizationRequest: {},
      },
      { client: this.#client },
    );
  }

  public async getGithubConnection(
    organizationId: string,
  ): Promise<GithubOrganizationConnectionStatus> {
    return getGithubOrganizationConnection(
      { organization_id: organizationId },
      { client: this.#client },
    );
  }

  public async linkSource(input: {
    readonly projectId: string;
    readonly repositoryOwner: string;
    readonly repositoryName: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
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

  public async configureAutoDeploy(input: {
    readonly projectId: string;
    readonly branch: string;
    readonly enabled: boolean;
    readonly idempotencyKey: string;
  }): Promise<SourceAutoDeploy> {
    return configureProjectSourceAutoDeploy(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        configureSourceAutoDeployRequest: { branch: input.branch, enabled: input.enabled },
      },
      { client: this.#client },
    );
  }

  public async getAutoDeploy(projectId: string): Promise<SourceAutoDeploy> {
    return getProjectSourceAutoDeploy({ project_id: projectId }, { client: this.#client });
  }

  public async authorizeCloudflareDns(input: {
    readonly projectId: string;
    readonly zone: string;
    readonly idempotencyKey: string;
  }): Promise<CloudflareDnsAuthorization> {
    return createCloudflareDnsAuthorization(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        createCloudflareDnsAuthorizationRequest: { zone: input.zone },
      },
      { client: this.#client },
    );
  }

  public async getCloudflareDnsStatus(
    projectId: string,
  ): Promise<CloudflareDnsAuthorizationStatus> {
    return getCloudflareDnsAuthorizationStatus({ project_id: projectId }, { client: this.#client });
  }

  public async applyProjectDomains(input: {
    readonly projectId: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
    return configureProjectDomains(
      { "Idempotency-Key": input.idempotencyKey, project_id: input.projectId },
      { client: this.#client },
    );
  }

  public async planDeployment(input: {
    readonly projectId: string;
    readonly commitSha: string;
    readonly environment: "dev" | "prod";
  }): Promise<DeploymentPlan> {
    return planDeployment(
      {
        project_id: input.projectId,
        planDeploymentRequest: { commit_sha: input.commitSha, environment: input.environment },
      },
      { client: this.#client },
    );
  }

  public async createDeployment(input: {
    readonly projectId: string;
    readonly planId: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
    return createDeployment(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        createDeploymentRequest: { plan_id: input.planId },
      },
      { client: this.#client },
    );
  }

  public async getDeployment(input: {
    readonly projectId: string;
    readonly deploymentId: string;
  }): Promise<Deployment> {
    return getDeployment(
      { project_id: input.projectId, deployment_id: input.deploymentId },
      { client: this.#client },
    );
  }

  public async streamOperationEvents(
    operationId: string,
    signal: AbortSignal,
    lastEventId?: string,
  ): Promise<AsyncIterable<OperationEvent>> {
    return (
      await streamOperationEvents(
        { operation_id: operationId },
        {
          client: this.#client,
          signal,
          // The generated client would otherwise retry a refused stream, such as a 404, forever.
          sseMaxRetryAttempts: 1,
          headers: {
            Accept: "text/event-stream",
            ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
          },
        },
      )
    ).stream;
  }
  public async getDeploymentLogs(input: {
    readonly projectId: string;
    readonly deploymentId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<DeploymentDiagnosticPage> {
    return getDeploymentLogs(
      {
        project_id: input.projectId,
        deployment_id: input.deploymentId,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      { client: this.#client },
    );
  }

  public async planRollback(input: {
    readonly projectId: string;
    readonly deploymentId: string;
  }): Promise<GuardedActionPlan> {
    return planDeploymentRollback(
      { project_id: input.projectId, target_deployment_id: input.deploymentId },
      { client: this.#client },
    );
  }

  public async rollback(input: {
    readonly projectId: string;
    readonly deploymentId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
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

  public async planPromotion(input: {
    readonly projectId: string;
    readonly sourceDeploymentId: string;
  }): Promise<GuardedActionPlan> {
    return planDeploymentPromotion(
      { project_id: input.projectId, source_deployment_id: input.sourceDeploymentId },
      { client: this.#client },
    );
  }

  public async promote(input: {
    readonly projectId: string;
    readonly sourceDeploymentId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
    return promoteDeployment(
      {
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.ifMatch,
        "X-Confirmation-Token": input.confirmationToken,
        project_id: input.projectId,
        source_deployment_id: input.sourceDeploymentId,
      },
      { client: this.#client },
    );
  }

  public async planDelete(projectId: string): Promise<GuardedActionPlan> {
    return planProjectDeletion({ project_id: projectId }, { client: this.#client });
  }

  public async deleteProject(input: {
    readonly projectId: string;
    readonly ifMatch: string;
    readonly confirmationToken: string;
    readonly idempotencyKey: string;
  }): Promise<Operation> {
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

  public async listEnvironmentSecrets(input: {
    readonly projectId: string;
    readonly environmentId: string;
  }): Promise<EnvironmentSecretPage> {
    return listEnvironmentSecrets(
      { project_id: input.projectId, environment_id: input.environmentId },
      { client: this.#client },
    );
  }

  public async listFunctionRuns(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly limit: number;
  }): Promise<FunctionRunPage> {
    return listFunctionRuns(
      { project_id: input.projectId, environment_id: input.environmentId, limit: input.limit },
      { client: this.#client },
    );
  }

  public async putEnvironmentSecret(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly name: string;
    readonly value: string;
    readonly idempotencyKey: string;
  }): Promise<EnvironmentSecret> {
    return putEnvironmentSecret(
      {
        "Idempotency-Key": input.idempotencyKey,
        project_id: input.projectId,
        environment_id: input.environmentId,
        secret_name: input.name,
        putEnvironmentSecretRequest: { value: input.value },
      },
      { client: this.#client },
    );
  }

  public async deleteEnvironmentSecret(input: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly name: string;
    readonly idempotencyKey: string;
  }): Promise<DeleteEnvironmentSecretResult> {
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

  public managedMail(input: ManagedMailCommand) {
    return executeManagedMail(this.#client, input);
  }
}
