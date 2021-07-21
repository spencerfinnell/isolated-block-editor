/**
 * External dependencies
 */
import { v4 as uuidv4 } from 'uuid';
import { noop } from 'lodash';
import { createDocument } from 'asblocks/src/lib/yjs-doc';
import { postDocToObject, updatePostDoc } from 'asblocks/src/components/editor/sync/algorithms/yjs';

/**
 * WordPress dependencies
 */
import { useDispatch, useSelect } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';

import { registerFormatCollabCaret } from '../formats/collab-caret';

const debug = require( 'debug' )( 'iso-editor:collab' );

/** @typedef {import('../..').CollaborationSettings} CollaborationSettings */
/** @typedef {import('../..').CollaborationTransport} CollaborationTransport */
/** @typedef {import('../..').CollaborationPeers} CollaborationPeers */
/** @typedef {import('.').OnUpdate} OnUpdate */

/**
 * @param {object} opts - Hook options
 * @param {object[]} opts.blocks
 * @param {OnUpdate} opts.onRemoteDataChange Function to update editor blocks in redux state.
 * @param {string} [opts.channelId] Optional channel id to pass to the transport.
 * @param {CollaborationTransport} opts.transport Transport module.
 * @param {() => Selection} opts.getSelection
 * @param {(peers: CollaborationPeers) => void} opts.setAvailablePeers
 * @param {(peer: string, selection: Selection) => void} opts.setPeerSelection
 *
 * @typedef Selection
 * @property {object} selectionStart
 * @property {object} selectionEnd
 */
async function initYDoc( {
	blocks,
	onRemoteDataChange,
	channelId,
	transport,
	getSelection,
	setPeerSelection,
	setAvailablePeers,
} ) {
	/** @type string */
	const identity = uuidv4();

	debug( `initYDoc (identity: ${ identity })` );

	const doc = createDocument( {
		identity,
		applyDataChanges: updatePostDoc,
		getData: postDocToObject,
		/** @param {object} message */
		sendMessage: ( message ) => {
			debug( 'sendDocMessage', message );
			transport.sendDocMessage( { type: 'doc', identity, message } );

			const { selectionStart, selectionEnd } = getSelection() || {};
			debug( 'sendSelection', selectionStart, selectionEnd );
			transport.sendSelection( {
				type: 'selection',
				identity,
				selection: {
					start: selectionStart,
					end: selectionEnd,
				},
			} );
		},
	} );

	const onReceiveMessage = ( data ) => {
		debug( 'remote change received by transport', data );

		switch ( data.type ) {
			case 'doc': {
				doc.receiveMessage( data.message );
				break;
			}
			case 'selection': {
				setPeerSelection( data.identity, data.selection );
				break;
			}
		}
	};

	doc.onRemoteDataChange( ( changes ) => {
		debug( 'remote change received by ydoc', changes );
		onRemoteDataChange( changes.blocks );
	} );

	return transport
		.connect( {
			identity,
			onReceiveMessage,
			setAvailablePeers: ( peers ) => {
				debug( 'setAvailablePeers', peers );
				setAvailablePeers( peers );
			},
			channelId,
		} )
		.then( ( { isFirstInChannel } ) => {
			debug( `connected (channelId: ${ channelId })` );

			if ( isFirstInChannel ) {
				debug( 'first in channel' );
				doc.startSharing( { title: '', blocks } );
			} else {
				doc.connect();
			}

			const disconnect = () => {
				transport.disconnect();
				doc.disconnect();
			};

			window.addEventListener( 'beforeunload', () => disconnect() );

			return { doc, disconnect };
		} );
}

/**
 * @param {object} opts - Hook options
 * @param {object[]} opts.blocks
 * @param {OnUpdate} opts.onRemoteDataChange
 * @param {CollaborationSettings} [opts.settings]
 */
export default function useYjs( { blocks, onRemoteDataChange, settings } ) {
	const ydoc = useRef();

	const getSelection = useSelect( ( select ) => {
		return select( 'isolated/editor' ).getEditorSelection;
	}, [] );

	const { setAvailablePeers, setPeerSelection } = useDispatch( 'isolated/editor' );

	useEffect( () => {
		if ( ! settings?.enabled ) {
			return;
		}

		if ( ! settings.transport ) {
			console.error( `Collaborative editor is disabled because a transport module wasn't provided.` );
			return;
		}

		debug( 'registered collab caret format' );
		registerFormatCollabCaret();

		let onUnmount = noop;

		initYDoc( {
			blocks,
			onRemoteDataChange,
			channelId: settings.channelId,
			transport: settings.transport,
			getSelection,
			setPeerSelection,
			setAvailablePeers,
		} ).then( ( { doc, disconnect } ) => {
			ydoc.current = doc;
			onUnmount = () => {
				debug( 'unmount' );
				disconnect();
			};
		} );

		return () => onUnmount();
	}, [] );

	// noop when collab is disabled (i.e. ydoc isn't initialized)
	// @ts-ignore: Don't know how to fix :(
	const applyChangesToYjs = ( blocks ) => ydoc.current?.applyDataChanges?.( { blocks } );

	return [ applyChangesToYjs ];
}
