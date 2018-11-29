/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/node/ipc';
import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { IURLService, IURLHandler } from 'vs/platform/url/common/url';

export interface IURLServiceChannel extends IChannel {
	call(command: 'open', url: string): Thenable<boolean>;
	call(command: string, arg?: any): Thenable<any>;
}

export class URLServiceChannel implements IURLServiceChannel {

	constructor(private service: IURLService) { }

	listen<T>(event: string, arg?: any): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(command: string, arg?: any): Thenable<any> {
		switch (command) {
			case 'open': return this.service.open(URI.revive(arg));
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class URLServiceChannelClient implements IURLService {

	_serviceBrand: any;

	constructor(private channel: IChannel) { }

	open(url: URI): Thenable<boolean> {
		return this.channel.call('open', url.toJSON());
	}

	registerHandler(handler: IURLHandler): IDisposable {
		throw new Error('Not implemented.');
	}
}

export interface IURLHandlerChannel extends IChannel {
	call(command: 'handleURL', arg: any): Thenable<boolean>;
	call(command: string, arg?: any): Thenable<any>;
}

export class URLHandlerChannel implements IURLHandlerChannel {

	constructor(private handler: IURLHandler) { }

	listen<T>(event: string, arg?: any): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(command: string, arg?: any): Thenable<any> {
		switch (command) {
			case 'handleURL': return this.handler.handleURL(URI.revive(arg));
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class URLHandlerChannelClient implements IURLHandler {

	constructor(private channel: IChannel) { }

	handleURL(uri: URI): Thenable<boolean> {
		return this.channel.call('handleURL', uri.toJSON());
	}
}
