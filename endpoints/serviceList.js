// Paths of the services we implement
const PATHS = {
    auth: "/auth/",
    news: "/news/",
    profiles: "/profile/",
    entitlement: "/profile",
    avatar: "/profile/avatar",
    savedGames: "/ugc/",
    ugc: "/ugc/",
    ugcPublicIn1: "/ugc/public/in1/",
    ugcPrivateIn1: "/ugc/private/in1/"
};

// Unimplemented services still go to this server so their requests show up in the log.
const GAMES = {
    in1: {
        platforms: ["ios", "win8rt", "wiiu"],
        services: {
            url_authentication: PATHS.auth,
            url_feed_ticker: PATHS.news,
            url_saved_games: PATHS.savedGames,
            url_ugc_public: PATHS.ugcPublicIn1,
            url_ugc_private: PATHS.ugcPrivateIn1,
            url_profiles: PATHS.profiles,
            server_avatar: PATHS.avatar
        },
        placeholders: [
            "url_didcreate",
            "url_bi",
            "url_geopixel",
            "url_feed_storefront",
            "url_catalogs",
            "url_missions",
            "url_latest_game_version",
            "url_update_client",
            "url_social",
            "url_phrase_chat",
            "url_disney_shop",
            "disney_shop",
            "url_events",
            "url_activity_stream",
            "url_activity_stream_social",
            "url_activity_stream_icons",
            "url_activity_stream_links",
            "url_geoip_locale",
            "url_togo_videos"
        ]
    },
    // TODO: check what services IN2 uses
    in2: {
        platforms: ["infinity2/ios"],
        services: {
            url_cg_did_auth: PATHS.auth,
            url_inf_ticker: PATHS.news,
            url_inf_ugc: PATHS.ugc,
            url_inf_profile: PATHS.profiles,
            url_inf_entitlement: PATHS.entitlement,
            url_social_server_avatar: PATHS.avatar
        },
        placeholders: [
            "url_inf_leaderboard",
            "url_cg_did_create",
            "domain_cg_natneg",
            "url_cg_friends",
            "url_cdn_videos",
            "url_social_phrase_chat",
            "url_cg_bi",
            "url_cg_cleanspeak",
            "url_cg_p2p_session",
            "url_activity_stream_social",
            "url_activity_stream_icons",
            "url_activity_stream_links",
            "url_social_like",
            "url_geo_ip_locale",
            "url_geo_pixel"
        ]
    }
};

function buildServiceList(game, baseUrl) {
    const { services, placeholders } = GAMES[game];
    const list = {};
    for (const [key, servicePath] of Object.entries(services)) {
        list[key] = baseUrl + servicePath;
    }
    for (const key of placeholders) {
        list[key] = `${baseUrl}/${key}`;
    }
    return list;
}

module.exports = {
    GAMES,
    buildServiceList
};
