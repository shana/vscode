/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageLegacyService, IStorageLegacy } from 'vs/platform/storage/common/storageLegacyService';
import { endsWith, startsWith, rtrim } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';

/**
 * We currently store local storage with the following format:
 *
 * [Global]
 * storage://global/<key>
 *
 * [Workspace]
 * storage://workspace/<folder>/<key>
 * storage://workspace/empty:<id>/<key>
 * storage://workspace/root:<id>/<key>
 *
 * <folder>
 * macOS/Linux: /some/folder/path
 *     Windows: c%3A/Users/name/folder (normal path)
 *              file://localhost/c%24/name/folder (unc path)
 *
 * [no workspace]
 * storage://workspace/__$noWorkspace__<key>
 * => no longer being used (used for empty workspaces previously)
 */

const EMPTY_WORKSPACE_PREFIX = `${StorageLegacyService.COMMON_PREFIX}workspace/empty:`;
const MULTI_ROOT_WORKSPACE_PREFIX = `${StorageLegacyService.COMMON_PREFIX}workspace/root:`;
const NO_WORKSPACE_PREFIX = 'storage://workspace/__$noWorkspace__';

export type StorageObject = { [key: string]: string };

export interface IParsedStorage {
	global: Map<string, string>;
	multiRoot: Map<string, StorageObject>;
	folder: Map<string, StorageObject>;
	empty: Map<string, StorageObject>;
	noWorkspace: StorageObject;
}

/**
 * Parses the local storage implementation into global, multi root, folder and empty storage.
 */
export function parseStorage(storage: IStorageLegacy): IParsedStorage {
	const globalStorage = new Map<string, string>();
	const noWorkspaceStorage: StorageObject = Object.create(null);
	const folderWorkspacesStorage = new Map<string /* workspace file resource */, StorageObject>();
	const emptyWorkspacesStorage = new Map<string /* empty workspace id */, StorageObject>();
	const multiRootWorkspacesStorage = new Map<string /* multi root workspace id */, StorageObject>();

	const workspaces: { prefix: string; resource: string; }[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);

		// Workspace Storage (storage://workspace/)
		if (startsWith(key, StorageLegacyService.WORKSPACE_PREFIX)) {

			// No Workspace key is for extension development windows
			if (key.indexOf('__$noWorkspace__') > 0) {

				// storage://workspace/__$noWorkspace__someKey => someKey
				const noWorkspaceStorageKey = key.substr(NO_WORKSPACE_PREFIX.length);

				noWorkspaceStorage[noWorkspaceStorageKey] = storage.getItem(key);
			}

			// We are looking for key: storage://workspace/<folder>/workspaceIdentifier to be able to find all folder
			// paths that are known to the storage. is the only way how to parse all folder paths known in storage.
			else if (endsWith(key, StorageLegacyService.WORKSPACE_IDENTIFIER)) {

				// storage://workspace/<folder>/workspaceIdentifier => <folder>/
				let workspace = key.substring(StorageLegacyService.WORKSPACE_PREFIX.length, key.length - StorageLegacyService.WORKSPACE_IDENTIFIER.length);

				// macOS/Unix: Users/name/folder/
				//    Windows: c%3A/Users/name/folder/
				if (!startsWith(workspace, 'file:')) {
					workspace = `file:///${rtrim(workspace, '/')}`;
				}

				// Windows UNC path: file://localhost/c%3A/Users/name/folder/
				else {
					workspace = rtrim(workspace, '/');
				}

				// storage://workspace/<folder>/workspaceIdentifier => storage://workspace/<folder>/
				const prefix = key.substr(0, key.length - StorageLegacyService.WORKSPACE_IDENTIFIER.length);
				workspaces.push({ prefix, resource: workspace });
			}

			// Empty workspace key: storage://workspace/empty:<id>/<key>
			else if (startsWith(key, EMPTY_WORKSPACE_PREFIX)) {

				// storage://workspace/empty:<id>/<key> => <id>
				const emptyWorkspaceId = key.substring(EMPTY_WORKSPACE_PREFIX.length, key.indexOf('/', EMPTY_WORKSPACE_PREFIX.length));
				const emptyWorkspaceResource = URI.from({ path: emptyWorkspaceId, scheme: 'empty' }).toString();

				let emptyWorkspaceStorage = emptyWorkspacesStorage.get(emptyWorkspaceResource);
				if (!emptyWorkspaceStorage) {
					emptyWorkspaceStorage = Object.create(null);
					emptyWorkspacesStorage.set(emptyWorkspaceResource, emptyWorkspaceStorage);
				}

				// storage://workspace/empty:<id>/someKey => someKey
				const storageKey = key.substr(EMPTY_WORKSPACE_PREFIX.length + emptyWorkspaceId.length + 1 /* trailing / */);

				emptyWorkspaceStorage[storageKey] = storage.getItem(key);
			}

			// Multi root workspace key: storage://workspace/root:<id>/<key>
			else if (startsWith(key, MULTI_ROOT_WORKSPACE_PREFIX)) {

				// storage://workspace/root:<id>/<key> => <id>
				const multiRootWorkspaceId = key.substring(MULTI_ROOT_WORKSPACE_PREFIX.length, key.indexOf('/', MULTI_ROOT_WORKSPACE_PREFIX.length));
				const multiRootWorkspaceResource = URI.from({ path: multiRootWorkspaceId, scheme: 'root' }).toString();

				let multiRootWorkspaceStorage = multiRootWorkspacesStorage.get(multiRootWorkspaceResource);
				if (!multiRootWorkspaceStorage) {
					multiRootWorkspaceStorage = Object.create(null);
					multiRootWorkspacesStorage.set(multiRootWorkspaceResource, multiRootWorkspaceStorage);
				}

				// storage://workspace/root:<id>/someKey => someKey
				const storageKey = key.substr(MULTI_ROOT_WORKSPACE_PREFIX.length + multiRootWorkspaceId.length + 1 /* trailing / */);

				multiRootWorkspaceStorage[storageKey] = storage.getItem(key);
			}
		}

		// Global Storage (storage://global)
		else if (startsWith(key, StorageLegacyService.GLOBAL_PREFIX)) {

			// storage://global/someKey => someKey
			const globalStorageKey = key.substr(StorageLegacyService.GLOBAL_PREFIX.length);
			if (startsWith(globalStorageKey, StorageLegacyService.COMMON_PREFIX)) {
				continue; // filter out faulty keys that have the form storage://something/storage://
			}

			globalStorage.set(globalStorageKey, storage.getItem(key));
		}
	}

	// With all the folder paths known we can now extract storage for each path. We have to go through all workspaces
	// from the longest path first to reliably extract the storage. The reason is that one folder path can be a parent
	// of another folder path and as such a simple indexOf check is not enough.
	const workspacesByLength = workspaces.sort((w1, w2) => w1.prefix.length >= w2.prefix.length ? -1 : 1);
	const handledKeys = new Map<string, boolean>();
	workspacesByLength.forEach(workspace => {
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);

			if (handledKeys.has(key) || !startsWith(key, workspace.prefix)) {
				continue; // not part of workspace prefix or already handled
			}

			handledKeys.set(key, true);

			let folderWorkspaceStorage = folderWorkspacesStorage.get(workspace.resource);
			if (!folderWorkspaceStorage) {
				folderWorkspaceStorage = Object.create(null);
				folderWorkspacesStorage.set(workspace.resource, folderWorkspaceStorage);
			}

			// storage://workspace/<folder>/someKey => someKey
			const storageKey = key.substr(workspace.prefix.length);

			folderWorkspaceStorage[storageKey] = storage.getItem(key);
		}
	});

	return {
		global: globalStorage,
		multiRoot: multiRootWorkspacesStorage,
		folder: folderWorkspacesStorage,
		empty: emptyWorkspacesStorage,
		noWorkspace: noWorkspaceStorage
	};
}