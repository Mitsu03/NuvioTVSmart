// Watch party on the stream screen, mirroring Android StreamScreenViewModel
// partySource/sharedStream and the marked stream cards of StreamScreen.kt.
import { PartyRepository } from "../../../core/party/partyRepository.js";
import {
  isPartyHost,
  partyMediaKey,
  partyMember,
  partySourceMatches,
  partyStreamToEntry
} from "../../../core/party/partyModels.js";

function normalizedType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();
  return type === "tv" || type === "show" ? "series" : type;
}

function optionalInt(value) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isInteger(number)
    ? null
    : number;
}

export function createStreamScreenPartyMethods() {
  return {
    streamPartyKey() {
      const contentId =
        String(this.params?.itemId || "").trim() ||
        String(this.params?.videoId || "").split(":")[0];
      return partyMediaKey(
        normalizedType(this.params?.itemType),
        contentId,
        optionalInt(this.params?.season),
        optionalInt(this.params?.episode)
      );
    },
    /** The host's shared link for this title, as a stream entry (members only). */
    getPartySharedEntry() {
      const party = PartyRepository.getState().party;
      const stream = PartyRepository.getSharedStream();
      if (!party || isPartyHost(party) || !stream || stream.media_key !== this.streamPartyKey()) {
        this.partySharedCache = null;
        return null;
      }
      const hostName = partyMember(party, party.hostMemberId)?.display_name || "";
      const cached = this.partySharedCache;
      if (cached && cached.stream === stream && cached.hostName === hostName) return cached.entry;
      const entry = { ...partyStreamToEntry(stream), partyHostName: hostName };
      this.partySharedCache = { stream, hostName, entry };
      return entry;
    },
    getPartySource() {
      const party = PartyRepository.getState().party;
      return party && party.mediaKey === this.streamPartyKey() ? party.media.source : null;
    },
    isPartySourceStream(stream) {
      if (!stream || stream.partyShared) return false;
      const source = this.getPartySource();
      return Boolean(source) && partySourceMatches(source, stream);
    },
    bindStreamParty() {
      this.unbindStreamParty();
      let previousShared = this.getPartySharedEntry();
      let previousSource = JSON.stringify(this.getPartySource());
      const refresh = () => {
        const shared = this.getPartySharedEntry();
        const source = JSON.stringify(this.getPartySource());
        if (shared === previousShared && source === previousSource) return;
        const appeared = shared && shared !== previousShared;
        previousShared = shared;
        previousSource = source;
        this._filteredStreamsCache = null;
        // Android focuses the shared card when a link arrives, unless the user is browsing.
        if (appeared && !this.streamUserMovedFocus)
          this.focusState = { zone: "card", row: 0, action: "play" };
        this.requestRender();
      };
      this.streamPartyUnsubscribers = [
        PartyRepository.subscribeState(refresh),
        PartyRepository.subscribeSharedStream(refresh)
      ];
    },
    unbindStreamParty() {
      this.streamPartyUnsubscribers?.forEach((unsubscribe) => unsubscribe());
      this.streamPartyUnsubscribers = [];
      this.partySharedCache = null;
    }
  };
}
