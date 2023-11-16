这篇文章我们聊聊广播消费，因为广播消费在某些场景下真的有奇效。笔者会从**基础概念**、**实现机制**、**实战案例**三个方面一一展开，希望能帮助到大家。

# 1 基础概念

RocketMQ 支持两种消息模式：`集群消费`（ Clustering ）和`广播消费`（ Broadcasting ）。

**集群消费**：

同一 Topic 下的一条消息只会被同一消费组中的一个消费者消费。也就是说，消息被负载均衡到了同一个消费组的多个消费者实例上。

![](https://javayong.cn/pics/rocketmq/cluster.png?a=1)

**广播消费**：

当使用广播消费模式时，每条消息推送给集群内所有的消费者，保证消息至少被每个消费者消费一次。

![](https://javayong.cn/pics/rocketmq/broadcast.png?b=3)

# 2 源码解析

首先下图展示了广播消费的代码示例。

```java
public class PushConsumer {
    public static final String CONSUMER_GROUP = "myconsumerGroup";
    public static final String DEFAULT_NAMESRVADDR = "localhost:9876";
    public static final String TOPIC = "mytest";
    public static final String SUB_EXPRESSION = "TagA || TagC || TagD";

    public static void main(String[] args) throws InterruptedException, MQClientException {
        // 定义 DefaultPushConsumer 
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer(CONSUMER_GROUP);
        // 定义名字服务地址
        consumer.setNamesrvAddr(DEFAULT_NAMESRVADDR);
        // 定义消费读取位点
        consumer.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_LAST_OFFSET);
        // 定义消费模式
        consumer.setMessageModel(MessageModel.BROADCASTING);
        // 订阅主题信息
        consumer.subscribe(TOPIC, SUB_EXPRESSION);
        // 订阅消息监听器
        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            try {
                for (MessageExt messageExt : msgs) {
                    System.out.println(new String(messageExt.getBody()));
                }
            }catch (Exception e) {
                e.printStackTrace();
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });

        consumer.start();
        System.out.printf("Broadcast Consumer Started.%n");
    }
}
```

和集群消费不同的点在于下面的代码：

```java
consumer.setMessageModel(MessageModel.BROADCASTING);
```

接下来，我们从源码角度来看看广播消费和集群消费有哪些差异点 ？ 

首先进入 `DefaultMQPushConsumerImpl` 类的 `start` 方法 , 分析启动流程中他们两者的差异点：

![](https://javayong.cn/pics/rocketmq/pushconsumerstart.png?a=341)

**▍ 差异点1：拷贝订阅关系**

```java
private void copySubscription() throws MQClientException {
    try {
       Map<String, String> sub = this.defaultMQPushConsumer.getSubscription();
       if (sub != null) {
          for (final Map.Entry<String, String> entry : sub.entrySet()) {
              final String topic = entry.getKey();
              final String subString = entry.getValue();
              SubscriptionData subscriptionData = FilterAPI.buildSubscriptionData(topic, subString);
                this.rebalanceImpl.getSubscriptionInner().put(topic, subscriptionData);
            }
        }
       if (null == this.messageListenerInner) {
          this.messageListenerInner = this.defaultMQPushConsumer.getMessageListener();
       }
       // 注意下面的代码 , 集群模式下自动订阅重试主题 
       switch (this.defaultMQPushConsumer.getMessageModel()) {
           case BROADCASTING:
               break;
           case CLUSTERING:
                final String retryTopic = MixAll.getRetryTopic(this.defaultMQPushConsumer.getConsumerGroup());
                SubscriptionData subscriptionData = FilterAPI.buildSubscriptionData(retryTopic, SubscriptionData.SUB_ALL);
                this.rebalanceImpl.getSubscriptionInner().put(retryTopic, subscriptionData);
                break;
            default:
                break;
        }
    } catch (Exception e) {
        throw new MQClientException("subscription exception", e);
    }
}
```

在集群模式下，会自动订阅重试队列，而广播模式下，并没有这段代码。也就是说**广播模式下，不支持消息重试**。

**▍ 差异点2：本地进度存储**

```java
switch (this.defaultMQPushConsumer.getMessageModel()) {
    case BROADCASTING:
        this.offsetStore = new LocalFileOffsetStore(this.mQClientFactory, this.defaultMQPushConsumer.getConsumerGroup());
        break;
    case CLUSTERING:
        this.offsetStore = new RemoteBrokerOffsetStore(this.mQClientFactory, this.defaultMQPushConsumer.getConsumerGroup());
        break;
    default:
        break;
}
this.defaultMQPushConsumer.setOffsetStore(this.offsetStore);
```

我们可以看到消费进度存储的对象是： `LocalFileOffsetStore` , 进度文件存储在如下的主目录` /{用户主目录}/.rocketmq_offsets`。

```java
public final static String LOCAL_OFFSET_STORE_DIR = System.getProperty(
    "rocketmq.client.localOffsetStoreDir",
    System.getProperty("user.home") + File.separator + ".rocketmq_offsets");
```

进度文件是 `/mqClientId/{consumerGroupName}/offsets.json` 。

```java
this.storePath = LOCAL_OFFSET_STORE_DIR + File.separator + this.mQClientFactory.getClientId() + File.separator + this.groupName + File.separator + "offsets.json";
```

笔者创建了一个主题 ` mytest ` , 包含4个队列，进度文件内容如下：

![](https://javayong.cn/pics/rocketmq/broadcastoffset.png)

消费者启动后，我们可以将整个流程简化如下图，并继续整理差异点：

![](https://javayong.cn/pics/rocketmq/consumerbroadcastliucheng.png)

**▍ 差异点3：负载均衡消费该主题的所有 MessageQueue**

进入负载均衡抽象类 `RebalanceImpl` 的`rebalanceByTopic`方法 。

```java
private void rebalanceByTopic(final String topic, final boolean isOrder) {
    switch (messageModel) {
        case BROADCASTING: {
            Set<MessageQueue> mqSet = this.topicSubscribeInfoTable.get(topic);
            if (mqSet != null) {
                boolean changed = this.updateProcessQueueTableInRebalance(topic, mqSet, isOrder);
                // 省略代码
            } else {
                log.warn("doRebalance, {}, but the topic[{}] not exist.", consumerGroup, topic);
            }
            break;
        }
        case CLUSTERING: {
            Set<MessageQueue> mqSet = this.topicSubscribeInfoTable.get(topic);
            List<String> cidAll = this.mQClientFactory.findConsumerIdList(topic, consumerGroup);
            // 省略代码
            if (mqSet != null && cidAll != null) {
                List<MessageQueue> mqAll = new ArrayList<MessageQueue>();
                mqAll.addAll(mqSet);

                Collections.sort(mqAll);
                Collections.sort(cidAll);

                AllocateMessageQueueStrategy strategy = this.allocateMessageQueueStrategy;

                List<MessageQueue> allocateResult = null;
                try {
                     allocateResult = strategy.allocate(
                            this.consumerGroup,
                            this.mQClientFactory.getClientId(),
                            mqAll,
                            cidAll);
                    } catch (Throwable e) {
                        // 省略日志打印代码
                        return;
                    }
                Set<MessageQueue> allocateResultSet = new HashSet<MessageQueue>();
                if (allocateResult != null) {
                    allocateResultSet.addAll(allocateResult);
                }
                boolean changed = this.updateProcessQueueTableInRebalance(topic, allocateResultSet, isOrder);
                //省略代码
            }
            break;
        }
        default:
            break;
    }
}
```

从上面代码我们可以看到消息模式为广播消费模式时，消费者会消费该主题下所有的队列，这一点也可以从本地的进度文件 `offsets.json` 得到印证。 

**▍ 差异点4：不支持顺序消息**

我们知道**消费消息顺序服务会向 Borker 申请锁** 。消费者根据分配的队列 messageQueue ，向 Borker 申请锁 ，如果申请成功，则会拉取消息，如果失败，则定时任务每隔 20 秒会重新尝试。

```java
if (MessageModel.CLUSTERING.equals(ConsumeMessageOrderlyService.this.defaultMQPushConsumerImpl.messageModel())) {
    this.scheduledExecutorService.scheduleAtFixedRate(new Runnable() {
        @Override
        public void run() {
            try {
                ConsumeMessageOrderlyService.this.lockMQPeriodically();
            } catch (Throwable e) {
                log.error("scheduleAtFixedRate lockMQPeriodically exception", e);
            }
        }
    }, 1000 * 1, ProcessQueue.REBALANCE_LOCK_INTERVAL, TimeUnit.MILLISECONDS);
}
```

但是从上面的代码，我们发现只有在集群消费的时候才会定时申请锁，这样就会导致广播消费时，无法为负载均衡的队列申请锁，导致拉取消息服务一直无法获取消息数据。

笔者修改消费例子，在消息模式为广播模式的场景下，将消费模式从并发消费修改为顺序消费。

```java
consumer.registerMessageListener((MessageListenerOrderly) (msgs, context) -> {
    try {
        for (MessageExt messageExt : msgs) {
            System.out.println(new String(messageExt.getBody()));
        }
    }catch (Exception e) {
        e.printStackTrace();
    }
    return ConsumeOrderlyStatus.SUCCESS;
});
```

![](https://javayong.cn/pics/rocketmq/broadcastcantorder.gif)

通过 IDEA DEBUG 图，笔者观察到因为负载均衡后的队列无法获取到锁，所以拉取消息的线程无法发起拉取消息请求到 Broker , 也就不会走到消费消息的流程。

因此，**广播消费模式并不支持顺序消息**。

**▍ 差异点5：并发消费消费失败时，没有重试**

进入并发消息消费类`ConsumeMessageConcurrentlyService` 的处理消费结果方法 `processConsumeResult`。

```java
switch (this.defaultMQPushConsumer.getMessageModel()) {
    case BROADCASTING:
        for (int i = ackIndex + 1; i < consumeRequest.getMsgs().size(); i++) {
            MessageExt msg = consumeRequest.getMsgs().get(i);
            log.warn("BROADCASTING, the message consume failed, drop it, {}", msg.toString());
        }
        break;
    case CLUSTERING:
        List<MessageExt> msgBackFailed = new ArrayList<MessageExt>(consumeRequest.getMsgs().size());
        for (int i = ackIndex + 1; i < consumeRequest.getMsgs().size(); i++) {
            MessageExt msg = consumeRequest.getMsgs().get(i);
            boolean result = this.sendMessageBack(msg, context);
            if (!result) {
                msg.setReconsumeTimes(msg.getReconsumeTimes() + 1);
                msgBackFailed.add(msg);
            }
        }

        if (!msgBackFailed.isEmpty()) {
            consumeRequest.getMsgs().removeAll(msgBackFailed);

            this.submitConsumeRequestLater(msgBackFailed, consumeRequest.getProcessQueue(), consumeRequest.getMessageQueue());
        }
        break;
    default:
        break;
}
```

消费消息失败后，集群消费时，消费者实例会通过 **CONSUMER_SEND_MSG_BACK** 请求，将失败消息发回到 Broker 端。

但在广播模式下，仅仅是打印了消息信息。因此，**广播模式下，并没有消息重试**。

# 3 实战案例

广播消费主要用于两种场景：**消息推送**和**缓存同步**。

## 3.1 消息推送

笔者第一次接触广播消费的业务场景是神州专车司机端的消息推送。 

用户下单之后，订单系统生成专车订单，派单系统会根据相关算法将订单派给某司机，司机端就会收到派单推送。

![](https://javayong.cn/pics/rocketmq/drivercarpush.png)

推送服务是一个 TCP 服务（自定义协议），同时也是一个消费者服务，消息模式是广播消费。

司机打开司机端 APP 后，APP 会通过负载均衡和推送服务创建长连接，推送服务会保存 TCP 连接引用 （比如司机编号和 TCP channel 的引用）。

派单服务是生产者，将派单数据发送到 MetaQ ,  每个推送服务都会消费到该消息，推送服务判断本地内存中是否存在该司机的 TCP channel ， 若存在，则通过 TCP 连接将数据推送给司机端。

肯定有同学会问：假如网络原因，推送失败怎么处理 ？有两个要点：

1. 司机端 APP 定时主动拉取派单信息；

2. 当推送服务没有收到司机端的 ACK 时 ，也会一定时限内再次推送，达到阈值后，不再推送。

## 3.2 缓存同步

高并发场景下，很多应用使用本地缓存，提升系统性能 。

本地缓存可以是 HashMap 、ConcurrentHashMap ，也可以是缓存框架 Guava Cache 或者 Caffeine cache 。

![](https://javayong.cn/pics/rocketmq/broadcastcachepush.png)

如上图，应用A启动后，作为一个 RocketMQ 消费者，消息模式设置为广播消费。为了提升接口性能，每个应用节点都会将字典表加载到本地缓存里。

当字典表数据变更时，可以通过业务系统发送一条消息到 RocketMQ ，每个应用节点都会消费消息，刷新本地缓存。

# 4 总结

集群消费和广播消费模式下，各功能的支持情况如下：

| 功能         | 集群消费   | 广播消费   |
| ------------ | ---------- | ---------- |
| 顺序消息     | 支持       | 不支持     |
| 重置消费位点 | 支持       | 不支持     |
| 消息重试     | 支持       | 不支持     |
| 消费进度     | 服务端维护 | 客户端维护 |

<br/>

广播消费主要用于两种场景：**消息推送**和**缓存同步**。


---

参考资料 ：

> https://www.51cto.com/article/714277.html
>
> https://ost.51cto.com/posts/21100

------

如果我的文章对你有所帮助，还请帮忙**点赞、在看、转发**一下，你的支持会激励我输出更高质量的文章，非常感谢！

![](https://javayong.cn/pics/zhihu/gongzhonghao.webp)

