import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import { Button } from "@/src/components/ui/button";
import { Icon } from "@/src/components/ui/icon";
import { Input } from "@/src/components/ui/input";
import { usePointerCoarse } from "@/src/components/ui/hooks/use-pointer-coarse";
import { cn } from "@/src/lib/utils";
import type { ProjectDirectory, rpcContract } from "../server";

interface Crumb {
  label: string;
  path: string;
}

function toBreadcrumb(directory: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "/", path: "/" }];
  let accumulated = "";
  for (const segment of directory.split("/").filter(Boolean)) {
    accumulated = `${accumulated}/${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

function joinHostPath(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

function folderNameError(name: string): string | null {
  if (!name || name === "." || name === "..") return "Enter a folder name.";
  if (/[\\/]/.test(name)) return "Folder names can't contain slashes.";
  return null;
}

export function RemotePathBrowser({
  hostId,
  onDirectoryChange,
  disabled = false,
}: {
  hostId: string;
  onDirectoryChange: (directory: string | null) => void;
  disabled?: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [listing, setListing] = useState<ProjectDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const isPointerCoarse = usePointerCoarse();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);
    onDirectoryChange(null);
    void rpc
      .call("listProjectDirectories", { hostId, path: currentPath })
      .then((result) => {
        if (!current) return;
        setListing(result);
        onDirectoryChange(result.directory);
      })
      .catch(() => {
        if (!current) return;
        setListing(null);
        setLoadError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [currentPath, hostId, onDirectoryChange, rpc]);

  useEffect(() => {
    if (isEditing && !isPointerCoarse) editInputRef.current?.focus();
  }, [isEditing, isPointerCoarse]);

  useEffect(() => {
    if (isCreatingFolder && !isPointerCoarse)
      newFolderInputRef.current?.focus();
  }, [isCreatingFolder, isPointerCoarse]);

  const navigateTo = (path: string) => {
    setIsCreatingFolder(false);
    setNewFolderError(null);
    setCurrentPath(path);
  };

  const createFolder = async () => {
    const directory = listing?.directory;
    const name = newFolderName.trim();
    const message = folderNameError(name);
    if (!directory || message) {
      setNewFolderError(message ?? "Couldn't create that folder.");
      return;
    }
    const path = joinHostPath(directory, name);
    setCreatingFolder(true);
    setNewFolderError(null);
    try {
      await rpc.call("createProjectDirectory", { hostId, path });
      setNewFolderName("");
      navigateTo(path);
    } catch {
      setNewFolderError("Couldn't create that folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const directory = listing?.directory ?? null;
  const crumbs = directory ? toBreadcrumb(directory) : [];
  const interactionDisabled = disabled || creatingFolder;

  let body: ReactNode;
  if (loadError) {
    body = (
      <p className="px-2 py-3 text-center text-sm text-destructive">
        Couldn't read this folder.
      </p>
    );
  } else if (loading || !listing) {
    body = (
      <p className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" /> Loading…
      </p>
    );
  } else if (listing.entries.length === 0) {
    body = (
      <p className="px-2 py-3 text-center text-sm text-muted-foreground">
        This folder is empty.
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col">
        {listing.entries.map((entry) =>
          entry.kind === "file" ? (
            <li
              key={entry.path}
              className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
            >
              <Icon name="File" className="size-4 shrink-0" />
              <span className="min-w-0 truncate" title={entry.name}>
                {entry.name}
              </span>
            </li>
          ) : (
            <li key={entry.path}>
              <button
                type="button"
                disabled={interactionDisabled}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted disabled:pointer-events-none"
                onClick={() => navigateTo(entry.path)}
              >
                <Icon
                  name="Folder"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 truncate" title={entry.name}>
                  {entry.name}
                </span>
                <Icon
                  name="ChevronRight"
                  className="ml-auto size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          ),
        )}
      </ul>
    );
  }

  return (
    <div className="flex flex-col rounded-md border">
      <div className="flex items-center gap-1 border-b px-1.5 py-1">
        {isEditing ? (
          <>
            <Input
              ref={editInputRef}
              aria-label="Project path"
              className="h-7 flex-1 text-xs"
              value={editValue}
              disabled={disabled}
              placeholder="/path/to/project"
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setIsEditing(false);
                  if (editValue.trim()) navigateTo(editValue.trim());
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setIsEditing(false);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Go to path"
              disabled={disabled}
              onClick={() => {
                setIsEditing(false);
                if (editValue.trim()) navigateTo(editValue.trim());
              }}
            >
              <Icon name="Check" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Go to parent folder"
              disabled={interactionDisabled || !listing?.parent}
              onClick={() => listing?.parent && navigateTo(listing.parent)}
            >
              <Icon name="ArrowUp" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-xs text-muted-foreground">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex items-center">
                  {index > 0 ? (
                    <Icon
                      name="ChevronRight"
                      className="size-3 shrink-0 opacity-50"
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={interactionDisabled}
                    className={cn(
                      "rounded px-1 py-0.5 hover:bg-muted hover:text-foreground",
                      index === crumbs.length - 1 &&
                        "font-medium text-foreground",
                    )}
                    onClick={() => navigateTo(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="New folder"
              disabled={interactionDisabled || !directory || loadError}
              onClick={() => {
                setNewFolderName("");
                setNewFolderError(null);
                setIsCreatingFolder(true);
              }}
            >
              <Icon name="FolderPlus" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Edit path"
              disabled={interactionDisabled}
              onClick={() => {
                setEditValue(directory ?? "");
                setIsEditing(true);
              }}
            >
              <Icon name="Edit" />
            </Button>
          </>
        )}
      </div>

      <div className="h-56 min-h-0 overflow-y-auto px-1.5 py-1">
        {isCreatingFolder ? (
          <div
            role="group"
            aria-label="Create new folder"
            className="mb-1 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2 px-2">
              <Icon
                name="Folder"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <Input
                ref={newFolderInputRef}
                aria-label="New folder name"
                className="-ml-1 h-7 min-w-0 flex-1 px-1 text-sm"
                value={newFolderName}
                disabled={interactionDisabled}
                placeholder="Folder name"
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                  setNewFolderError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createFolder();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setIsCreatingFolder(false);
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Create folder"
                disabled={interactionDisabled}
                onClick={() => void createFolder()}
              >
                <Icon
                  name={creatingFolder ? "Spinner" : "Check"}
                  className={cn(creatingFolder && "animate-spin")}
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Cancel new folder"
                disabled={interactionDisabled}
                onClick={() => setIsCreatingFolder(false)}
              >
                <Icon name="X" />
              </Button>
            </div>
            {newFolderError ? (
              <p role="alert" className="px-2 text-xs text-destructive">
                {newFolderError}
              </p>
            ) : null}
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
}
