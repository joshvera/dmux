import fs from 'fs';
import path from 'path';

export interface SessionOwnershipContext {
  sessionProjectRoot: string;
}

export interface SessionOwnershipInput {
  sessionName?: string | null;
  currentPaneId?: string | null;
  controlPaneId?: string | null;
  sessionContext?: SessionOwnershipContext | null;
  currentProjectRoot: string;
}

export interface SessionOwnershipClassification {
  isForeignManagedSession: boolean;
  ownsCurrentSession: boolean;
  shouldOfferAttachToCurrentSession: boolean;
  shouldPublishRuntimeMetadata: boolean;
}

export interface RuntimeMetadataPublicationInput {
  sessionOwnership: Pick<
    SessionOwnershipClassification,
    'isForeignManagedSession' | 'ownsCurrentSession'
  >;
  currentPaneOwnsControlPane: boolean;
  hasRecordedControllerPid: boolean;
  isRecordedControllerAlive: boolean;
}

function normalizeProjectRoot(projectRoot: string): string {
  try {
    return fs.realpathSync.native(projectRoot);
  } catch {
    return path.resolve(projectRoot);
  }
}

export function classifySessionOwnership({
  sessionName,
  currentPaneId,
  controlPaneId,
  sessionContext,
  currentProjectRoot,
}: SessionOwnershipInput): SessionOwnershipClassification {
  const isForeignManagedSession =
    !!sessionName
    && !!sessionContext?.sessionProjectRoot
    && normalizeProjectRoot(sessionContext.sessionProjectRoot)
      !== normalizeProjectRoot(currentProjectRoot);

  const ownsCurrentSession =
    !!sessionName
    && !!currentPaneId
    && !!controlPaneId
    && currentPaneId === controlPaneId;

  return {
    isForeignManagedSession,
    ownsCurrentSession,
    shouldOfferAttachToCurrentSession: isForeignManagedSession,
    shouldPublishRuntimeMetadata: ownsCurrentSession && !isForeignManagedSession,
  };
}

export function shouldPublishRuntimeMetadata({
  sessionOwnership,
  currentPaneOwnsControlPane,
  hasRecordedControllerPid,
  isRecordedControllerAlive,
}: RuntimeMetadataPublicationInput): boolean {
  if (sessionOwnership.isForeignManagedSession) {
    return false;
  }

  if (currentPaneOwnsControlPane || sessionOwnership.ownsCurrentSession) {
    return true;
  }

  return !hasRecordedControllerPid || !isRecordedControllerAlive;
}
