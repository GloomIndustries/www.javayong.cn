import {navbar} from "vuepress-theme-hope";

export default navbar([
    //{ text: "Java基础", icon: "java",  link: "/home.md" },
    {text: "缓存实战", icon: "buffer", link: "/cache/01fourJDKlocalcache.html"},
    {text: "消息队列", icon: "Kafka", link: "/mq/rocketmq4/00RocketMQ4_introduce.html"},
   // {text: "分库分表", icon: "database", link: "/sharding/"},
    {
        text: "程序人生", icon: "life-ring", link: "/high-quality-technical-articles/",
    },
    {
        text: "B站视频",
        icon: "bilibili",
        link: "https://space.bilibili.com/472223327"
    },
]);
