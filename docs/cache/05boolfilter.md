---
title: 详解布隆过滤器
category: cache
tag:
  - cache 
  - 布隆过滤器
head:
  - - meta
    - name: keywords
      content: 布隆过滤器,缓存,Bloom Filter
  - - meta
    - name: description
      content: 对于后端程序员来讲，学习和理解布隆过滤器(Bloom Filter)有很大的必要性。来吧，我们一起品味布隆过滤器的设计之美。
---

布隆过滤器是一个精巧而且经典的数据结构。

你可能没想到： RocketMQ、 Hbase 、Cassandra 、LevelDB 、RocksDB 这些知名项目中都有布隆过滤器的身影。

对于后端程序员来讲，学习和理解布隆过滤器有很大的必要性。来吧，我们一起品味布隆过滤器的设计之美。

![](https://www.javayong.cn/pics/temp//gGTKn38KyF.webp!large)

## 1 缓存穿透

我们先来看一个商品服务查询详情的接口：

```java
    public Product queryProductById(Long id) {
       // 查询缓存
        Product product = queryFromCache(id);
        if (product != null) {
            return product;
        }
        // 从数据库查询
        product = queryFromDataBase(id);
        if (product != null) {
            saveCache(id, product);
        }
        return product;
    }
```

![](https://www.javayong.cn/pics/temp//szzXnQVHGA.webp!large)

假设此商品既不存储在缓存中，也不存在数据库中，则没有办法**回写缓存**，当有类似这样大量的请求访问服务时，数据库的压力就会极大。

这是一个典型的缓存穿透的场景。

为了解决这个问题呢，通常我们可以向分布式缓存中写入一个过期时间较短的空值占位，但这样会占用较多的存储空间，性价比不足。

问题的本质是："**如何以极小的代价检索一个元素是否在一个集合中**？"

我们的主角**布隆过滤器**出场了，它就能游刃有余的**平衡好时间和空间两种维度**。

## 2 原理解析

**布隆过滤器**（英语：Bloom Filter）是1970年由布隆提出的。它实际上是一个很长的**二进制向量**和一系列**随机映射函数**。

布隆过滤器可以用于检索一个元素是否在一个集合中。它的优点是**空间效率**和**查询时间**都**远远超过一般的算法**，缺点是有一定的误识别率和删除困难。

布隆过滤器的原理：当一个元素被加入集合时，通过 K 个散列函数将这个元素映射成一个位数组中的 K 个点，把它们置为 1。检索时，我们只要看看这些点是不是都是 1 就（大约）知道集合中有没有它了：如果这**些点有任何一个 0**，则**被检元素一定不在**；如果**都是 1**，则被检元素**很可能在**。

简单来说就是准备一个长度为 m 的位数组并初始化所有元素为 0，用 k 个散列函数对元素进行 k 次散列运算跟 len (m) 取余得到 k 个位置并将 m 中对应位置设置为 1。

![](https://www.javayong.cn/pics/temp//Qcb9oB5g1v.webp!large)

如上图，位数组的长度是８，散列函数个数是 3，先后保持两个元素ｘ，ｙ。这两个元素都经过三次哈希函数生成三个哈希值，并映射到位数组的不同的位置，并置为1。元素 x 映射到位数组的第０位，第４位，第７位，元素ｙ映射到数组的位数组的第１位，第４位，第６位。

保存元素 x 后，位数组的第4位被设置为1之后，在处理元素 y 时第4位会被覆盖，同样也会设置为 1。

当布隆过滤器**保存的元素越多**，**被置为 1 的 bit 位也会越来越多**，元素 x 即便没有存储过，假设哈希函数映射到位数组的三个位都被其他值设置为 1 了，对于布隆过滤器的机制来讲，元素 x 这个值也是存在的，也就是说布隆过滤器**存在一定的误判率**。

**▍ 误判率**

布隆过滤器包含如下四个属性：

- k : 哈希函数个数

- m : 位数组长度
- n : 插入的元素个数
- p : 误判率

若位数组长度太小则会导致所有 bit 位很快都会被置为 1 ，那么检索任意值都会返回”可能存在“ ， 起不到过滤的效果。 位数组长度越大，则误判率越小。

同时，哈希函数的个数也需要考量，哈希函数的个数越大，检索的速度会越慢，误判率也越小，反之，则误判率越高。

![](https://www.javayong.cn/pics/temp//9JhROcXyEi.webp!large)

从张图我们可以观察到相同位数组长度的情况下，随着哈希函数的个人的增长，误判率显著的下降。

误判率 p 的公式是![](https://www.javayong.cn/pics/temp//NntKce0NiK.webp!large)

1\. k 次哈希函数某一 bit 位未被置为 1 的概率为![](https://www.javayong.cn/pics/temp//AeAm0pE51W.webp!large)

2\. 插入 n 个元素后某一 bit 位依旧为 0 的概率为![](https://www.javayong.cn/pics/temp//JWSFwFmn1w.webp!large)

3\. 那么插入 n 个元素后某一 bit 位置为1的概率为![](https://www.javayong.cn/pics/temp//45NmbP5AEk.webp!large)
4\. 整体误判率为 ![](https://www.javayong.cn/pics/temp//786m1xNDFG.webp!large)，当 m 足够大时，误判率会越小，该公式约等于![](https://www.javayong.cn/pics/temp//VsYuYA5bWH.webp!large)

我们会预估布隆过滤器的误判率 p 以及待插入的元素个数 n 分别推导出最合适的位数组长度 m 和 哈希函数个数 k。

<img src="https://www.javayong.cn/pics/temp//up-f6c28a2073b26b6a18f7615b2a34c4fbf98.jpg" style="zoom:43%;" />

**▍ 布隆过滤器支持删除吗**

布隆过滤器其实并不支持删除元素，因为多个元素可能哈希到一个布隆过滤器的同一个位置，如果直接删除该位置的元素，则会影响其他元素的判断。

**▍ 时间和空间效率**

布隆过滤器的空间复杂度为 O(m) ，插入和查询时间复杂度都是 O(k) 。 存储空间和插入、查询时间都不会随元素增加而增大。 空间、时间效率都很高。

**▍哈希函数类型**

Murmur3，FNV 系列和 Jenkins 等非密码学哈希函数适合，因为 Murmur3 算法简单，能够平衡好速度和随机分布，很多开源产品经常选用它作为哈希函数。

## 3 Guava实现

Google Guava是 Google 开发和维护的开源 Java开发库，它包含许多基本的工具类，例如字符串处理、集合、并发工具、I/O和数学函数等等。

**1、添加Maven依赖**

```xml
<dependency>
    <groupId>com.google.guava</groupId>
    <artifactId>guava</artifactId>
    <version>31.0.1-jre<</version>
</dependency>
```

**2、创建布隆过滤器**

```java
BloomFilter<Integer> filter = BloomFilter.create(
  //Funnel 是一个接口，用于将任意类型的对象转换为字节流，
  //以便用于布隆过滤器的哈希计算。
  Funnels.integerFunnel(), 
  10000, 	// 插入数据条目数量
  0.001 	// 误判率
);
```

**3、添加数据**

```java
@PostConstruct
public void addProduct() {
    logger.info("初始化布隆过滤器数据开始");
    //插入4个元素
     filter.put(1L);
     filter.put(2L);
     filter.put(3L);
     filter.put(4L);
     logger.info("初始化布隆过滤器数据结束");
}
```

**4、判断数据是否存在**

```java
public boolean maycontain(Long id) {
    return filter.mightContain(id);
}
```

接下来，我们查看 Guava 源码中布隆过滤器是如何实现的 ？

```java
static <T> BloomFilter<T> create(Funnel<? super T> funnel, long expectedInsertions, double fpp, BloomFilter.Strategy strategy) {
    // 省略部分前置验证代码 
    // 位数组长度
    long numBits = optimalNumOfBits(expectedInsertions, fpp);
    // 哈希函数次数
    int numHashFunctions = optimalNumOfHashFunctions(expectedInsertions, numBits);
    try {
      return new BloomFilter<T>(
                    new LockFreeBitArray(numBits), 
                    numHashFunctions, 
                    funnel,
                    strategy
      );
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("Could not create BloomFilter of " + numBits + " bits", e);
    }
}
```

```java
//计算位数组长度
//n:插入的数据条目数量
//p:期望误判率
@VisibleForTesting
static long optimalNumOfBits(long n, double p) {
   if (p == 0) {
     p = Double.MIN_VALUE;
   }
   return (long) (-n * Math.log(p) / (Math.log(2) * Math.log(2)));
}

// 计算哈希次数
@VisibleForTesting
static int optimalNumOfHashFunctions(long n, long m) {
    // (m / n) * log(2), but avoid truncation due to division!
    return Math.max(1, (int) Math.round((double) m / n * Math.log(2)));
}
```

Guava 的计算位数组长度和哈希次数和原理解析这一节展示的公式保持一致。

重点来了，Bloom filter 是如何判断元素存在的 ？

方法名就非常有 google 特色 ， ”**mightContain**“ 的中文表意是：”可能存在“ 。**方法的返回值为 true ，元素可能存在，但若返回值为 false ，元素必定不存在。**

```java
public <T extends @Nullable Object> boolean mightContain(
    @ParametricNullness T object,
    //Funnel 是一个接口，用于将任意类型的对象转换为字节流，
    //以便用于布隆过滤器的哈希计算。
    Funnel<? super T> funnel,  
    //用于计算哈希值的哈希函数的数量
    int numHashFunctions,
    //位数组实例，用于存储布隆过滤器的位集
    LockFreeBitArray bits) {
  long bitSize = bits.bitSize();
  //使用 MurmurHash3 哈希函数计算对象 object 的哈希值，
  //并将其转换为一个 byte 数组。
  byte[] bytes = Hashing.murmur3_128().hashObject(object, funnel).getBytesInternal();
  long hash1 = lowerEight(bytes);
  long hash2 = upperEight(bytes);

            long combinedHash = hash1;
            for (int i = 0; i < numHashFunctions; i++) {
// Make the combined hash positive and indexable
// 计算哈希值的索引，并从位数组中查找索引处的位。
// 如果索引处的位为 0，表示对象不在布隆过滤器中，返回 false。
                if (!bits.get((combinedHash & Long.MAX_VALUE) % bitSize)) {
                    return false;
                }
// 将 hash2 加到 combinedHash 上，用于计算下一个哈希值的索引。
                combinedHash += hash2;
            }
            return true;
        }
```

## 4 Redisson实现

Redisson 是一个用 Java 编写的 Redis 客户端，它实现了分布式对象和服务，包括集合、映射、锁、队列等。Redisson的API简单易用，使得在分布式环境下使用Redis 更加容易和高效。

**1、添加Maven依赖**

```xml
<dependency>
  <groupId>org.redisson</groupId>
  <artifactId>redisson</artifactId>
  <version>3.16.1</version>
</dependency>
```

**2、配置 Redisson 客户端**

```java
@Configuration
public class RedissonConfig {

 Bean
 public RedissonClient redissonClient() {
    Config config = new Config();
    config.useSingleServer().setAddress("redis://localhost:6379");
    return Redisson.create(config);
 }
 
}
```

**3、初始化**

```java
RBloomFilter<Long> bloomFilter = redissonClient.
                                      getBloomFilter("myBloomFilter");
//10000表示插入元素的个数，0.001表示误判率
bloomFilter.tryInit(10000, 0.001);
//插入4个元素
bloomFilter.add(1L);
bloomFilter.add(2L);
bloomFilter.add(3L);
bloomFilter.add(4L);
```

**4、判断数据是否存在**

```java
public boolean mightcontain(Long id) {
    return bloomFilter.contains(id);
}
```

好，我们来从源码分析 Redisson 布隆过滤器是如何实现的 ？

```java
public boolean tryInit(long expectedInsertions, double falseProbability) {
    // 位数组大小
    size = optimalNumOfBits(expectedInsertions, falseProbability);
    // 哈希函数次数
    hashIterations = optimalNumOfHashFunctions(expectedInsertions, size);
    CommandBatchService executorService = new CommandBatchService(commandExecutor);
    // 执行 Lua脚本，生成配置
    executorService.evalReadAsync(configName, codec, RedisCommands.EVAL_VOID,
            "local size = redis.call('hget', KEYS[1], 'size');" +
                    "local hashIterations = redis.call('hget', KEYS[1], 'hashIterations');" +
                    "assert(size == false and hashIterations == false, 'Bloom filter config has been changed')",
                    Arrays.<Object>asList(configName), size, hashIterations);
    executorService.writeAsync(configName, StringCodec.INSTANCE,
                                            new RedisCommand<Void>("HMSET", new VoidReplayConvertor()), configName,
            "size", size, "hashIterations", hashIterations,
            "expectedInsertions", expectedInsertions, "falseProbability", BigDecimal.valueOf(falseProbability).toPlainString());
    try {
        executorService.execute();
    } catch (RedisException e) {
    }
    return true;
}
```

![Bf配置信息](https://www.javayong.cn/pics/temp//nSbowXJ8Dk.webp!large)

Redisson 布隆过滤器初始化的时候，会创建一个 Hash 数据结构的 key ，存储布隆过滤器的4个核心属性。

那么 Redisson 布隆过滤器如何保存元素呢 ？

```java
 public boolean add (T object){
            long[] hashes = hash(object);
            while (true) {
                int hashIterations = this.hashIterations;
                long size = this.size;
                long[] indexes = hash(hashes[0], hashes[1], hashIterations, size);
                CommandBatchService executorService = new CommandBatchService(commandExecutor);
                addConfigCheck(hashIterations, size, executorService);
//创建 bitset 对象， 然后调用setAsync方法，该方法的参数是索引。
                RBitSetAsync bs = createBitSet(executorService);
                for (int i = 0; i < indexes.length; i++) {
                    bs.setAsync(indexes[i]);
                }
                try {
                    List<Boolean> result = (List<Boolean>) executorService.execute().getResponses();
                    for (Boolean val : result.subList(1, result.size() - 1)) {
                        if (!val) {
                            return true;
                        }
                    }
                    return false;
                } catch (RedisException e) {
                }
            }
        }
```

从源码中，我们发现 Redisson 布隆过滤器操作的对象是 **位图（bitMap）** 。

在 Redis 中，位图本质上是 string 数据类型，Redis 中一个字符串类型的值最多能存储 512 MB 的内容，每个字符串由多个字节组成，每个字节又由 8 个 Bit 位组成。位图结构正是使用“位”来实现存储的，它通过将比特位设置为 0 或 1来达到数据存取的目的，它存储上限为 `2^32 `，我们可以使用`getbit/setbit`命令来处理这个位数组。

为了方便大家理解，我做了一个简单的测试。

![](https://www.javayong.cn/pics/temp//9GDwxhCukO.webp!large)

通过 Redisson API 创建 key 为 `mybitset `的 位图 ，设置索引 3 ，5，6，8 位为 1 ，右侧的**二进制值**也完全匹配。

## 5 实战要点

通过 Guava 和 Redisson 创建和使用布隆过滤器比较简单，我们下面讨论实战层面的注意事项。

**1、缓存穿透场景**

首先我们需要**初始化**布隆过滤器，然后当用户请求时，判断过滤器中是否包含该元素，若不包含该元素，则直接返回不存在。

若包含则从缓存中查询数据，若缓存中也没有，则查询数据库并回写到缓存里，最后给前端返回。

![](https://www.javayong.cn/pics/temp//f6Avy1Movi.webp!large)

**2、元素删除场景**

现实场景，元素不仅仅是只有增加，还存在删除元素的场景，比如说商品的删除。

原理解析这一节，我们已经知晓：**布隆过滤器其实并不支持删除元素，因为多个元素可能哈希到一个布隆过滤器的同一个位置，如果直接删除该位置的元素，则会影响其他元素的判断**。

从工程角度来看，**定时重新构建布隆过滤器**这个方案可行也可靠，同时也相对简单。

![](https://www.javayong.cn/pics/temp//wp53mfGqZW.webp!large)

1. 定时任务触发全量商品查询 ;
2. 将商品编号添加到新的布隆过滤器 ;
3. 任务完成，修改商品布隆过滤器的映射（从旧 A 修改成 新 B ）;
4. 商品服务根据布隆过滤器的映射，选择新的布隆过滤器 B进行相关的查询操作 ；
5. 选择合适的时间点，删除旧的布隆过滤器 A。

## 6 总结

**布隆过滤器**是一个很长的**二进制向量**和一系列**随机映射函数**，用于**检索一个元素是否在一个集合中**。

它的**空间效率**和**查询时间**都**远远超过一般的算法**，但是有一定的误判率 （函数返回 true , 意味着元素可能存在，函数返回 false ，元素必定不存在）。

布隆过滤器的四个核心属性：

- k : 哈希函数个数

- m : 位数组长度
- n : 插入的元素个数
- p : 误判率

Java 世界里 ，通过 Guava 和 Redisson 创建和使用布隆过滤器非常简单。

布隆过滤器无法删除元素，但我们可以通过**定时重新构建布隆过滤器**方案实现删除元素的效果。

为什么这么多的开源项目中使用布隆过滤器 ？

因为它的设计精巧且简洁，工程上实现非常容易，效能高，虽然有一定的误判率，但软件设计不就是要 trade off 吗 ？

------

参考资料：

> https://hackernoon.com/probabilistic-data-structures-bloom-filter-5374112a7832