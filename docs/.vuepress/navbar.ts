import {navbar} from "vuepress-theme-hope";

export default navbar([
    //{ text: "Java基础", icon: "java",  link: "/home.md" },
    {text: "缓存", icon: "redis", link: "/cache/"},
    {text: "分库分表", icon: "database", link: "/sharding/"},
    {text: "消息队列", icon: "MQ", link: "/mq/"},
    {
        text: "程序人生", icon: "article", link: "/high-quality-technical-articles/",
    }
]);
