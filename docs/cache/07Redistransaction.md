---
title: 聊聊 Redis 事务
category: cache
tag:
  - cache 
  - Redis
head:
  - - meta
    - name: keywords
      content: Lua,缓存,Redis 事务,事务
  - - meta
    - name: description
      content: Redis 事务包含两种模式 事务模式 和 Lua 脚本。
---

准确的讲，Redis 事务包含两种模式 : **事务模式** 和 **Lua 脚本**。

先说结论：

Redis 的事务模式具备如下特点：

- 保证隔离性；
- 无法保证持久性；
- 具备了一定的原子性，但不支持回滚；
- 一致性的概念有分歧，假设在一致性的核心是约束的语意下，Redis 的事务可以保证一致性。

但 Lua 脚本更具备实用场景，它是另一种形式的事务，他具备一定的原子性，但脚本报错的情况下，事务并不会回滚。Lua 脚本可以保证隔离性，而且可以完美的支持**后面的步骤依赖前面步骤的结果**。

**Lua 脚本模式的身影几乎无处不在，比如分布式锁、延迟队列、抢红包等场景。**

## 1 事务原理

Redis 的事务包含如下命令：

| 序号 | 命令及描述                                                   |
| :--- | :----------------------------------------------------------- |
| 1    | MULTI 标记一个事务块的开始。                                 |
| 2    | EXEC 执行所有事务块内的命令。                                |
| 3    | DISCARD 取消事务，放弃执行事务块内的所有命令。               |
| 4    | WATCH key [key ...] 监视一个(或多个) key ，如果在事务执行之前这个(或这些) key 被其他命令所改动，那么事务将被打断。 |
| 5    | UNWATCH 取消 WATCH 命令对所有 key 的监视。                   |

事务包含三个阶段：

1. 事务开启，使用 MULTI , 该命令标志着执行该命令的客户端从非事务状态切换至事务状态 ；
2. 命令入队，MULTI 开启事务之后，客户端的命令并不会被立即执行，而是放入一个事务队列 ；
3. 执行事务或者丢弃。如果收到 EXEC 的命令，事务队列里的命令将会被执行 ，如果是 DISCARD 则事务被丢弃。

下面展示一个事务的例子。

```
 redis> MULTI 
 OK
 redis> SET msg "hello world"
 QUEUED
 redis> GET msg
 QUEUED
 redis> EXEC
 1) OK
 1) hello world
```

这里有一个疑问？在开启事务的时候，Redis key 可以被修改吗？

![img](https://www.javayong.cn/pics/temp//zgcHEZMogT.webp!large)

**在事务执行 EXEC 命令之前 ，Redis key 依然可以被修改**。

在事务开启之前，我们可以 watch 命令监听 Redis key 。在事务执行之前，我们修改 key 值 ，事务执行失败，返回 **nil** 。

![img](https://www.javayong.cn/pics/temp//s5X2lsfqGT.webp!large)

 通过上面的例子，watch 命令可以**实现类似乐观锁的效果** 。

## 2 事务的ACID

### 2.1 原子性

原子性是指：一个事务中的所有操作，或者全部完成，或者全部不完成，不会结束在中间某个环节。事务在执行过程中发生错误，会被回滚到事务开始前的状态，就像这个事务从来没有执行过一样。

第一个例子：

在执行 EXEC 命令前，客户端发送的操作命令错误，比如：语法错误或者使用了不存在的命令。

```
 redis> MULTI
 OK
 redis> SET msg "other msg"
 QUEUED
 redis> wrongcommand  ### 故意写错误的命令
 (error) ERR unknown command 'wrongcommand' 
 redis> EXEC
 (error) EXECABORT Transaction discarded because of previous errors.
 redis> GET msg
 "hello world"
```

在这个例子中，我们使用了不存在的命令，导致入队失败，整个事务都将无法执行 。

第二个例子：

事务操作入队时，命令和操作的数据类型不匹配 ，入队列正常，但执行 EXEC 命令异常 。

```
 redis> MULTI  
 OK
 redis> SET msg "other msg"
 QUEUED
 redis> SET mystring "I am a string"
 QUEUED
 redis> HMSET mystring name  "test"
 QUEUED
 redis> SET msg "after"
 QUEUED
 redis> EXEC
 1) OK
 2) OK
 3) (error) WRONGTYPE Operation against a key holding the wrong kind of value
 4) OK
 redis> GET msg
 "after"
```

这个例子里，Redis 在执行 EXEC 命令时，如果出现了错误，Redis 不会终止其它命令的执行，事务也不会因为某个命令执行失败而回滚 。

综上，我对 Redis 事务原子性的理解如下：

1. 命令入队时报错， 会放弃事务执行，保证原子性；
2. 命令入队时正常，执行 EXEC 命令后报错，不保证原子性；

也就是：**Redis 事务在特定条件下，才具备一定的原子性** 。

### 2.2 隔离性

数据库的隔离性是指：数据库允许多个并发事务同时对其数据进行读写和修改的能力，隔离性可以防止多个事务并发执行时由于交叉执行而导致数据的不一致。

事务隔离分为不同级别 ，分别是：

- 未提交读（read uncommitted）
- 提交读（read committed）
- 可重复读（repeatable read）
- 串行化（serializable）

首先，需要明确一点：Redis 并没有事务隔离级别的概念。这里我们讨论 Redis 的隔离性是指：**并发场景下，事务之间是否可以做到互不干扰**。

我们可以将事务执行可以分为 **EXEC 命令执行前**和 **EXEC 命令执行后**两个阶段，分开讨论。

1. EXEC 命令执行前

在事务原理这一小节，我们发现在事务执行之前 ，Redis key 依然可以被修改。此时，可以使用 **WATCH 机制**来实现乐观锁的效果。

1. EXEC 命令执行后

因为 Redis 是单线程执行操作命令， EXEC 命令执行后，Redis 会保证命令队列中的所有命令执行完 。 这样就可以保证事务的隔离性。

### 2.3 持久性

数据库的持久性是指 ：事务处理结束后，对数据的修改就是永久的，即便系统故障也不会丢失。

Redis 的数据是否持久化取决于 Redis 的持久化配置模式 。

1. 没有配置 RDB 或者 AOF ，事务的持久性无法保证；
2. 使用了 RDB模式，在一个事务执行后，下一次的 RDB 快照还未执行前，如果发生了实例宕机，事务的持久性同样无法保证；
3. 使用了 AOF 模式；AOF 模式的三种配置选项 no 、everysec 都会存在数据丢失的情况  。always 可以保证事务的持久性，但因为性能太差，在生产环境一般不推荐使用。

综上，**redis 事务的持久性是无法保证的** 。

### 2.4 一致性

一致性的概念一直很让人困惑，在我搜寻的资料里，有两类不同的定义。

1. 维基百科

我们先看下维基百科上一致性的定义：

> Consistency ensures that a transaction can only bring the database from one valid state to another, maintaining database invariants: any data written to the database must be valid according to all defined rules, including constraints, cascades, triggers, and any combination thereof. This prevents database corruption by an illegal transaction, but does not guarantee that a transaction is correct. Referential integrity guarantees the primary key – foreign key relationship.

在这段文字里，一致性的核心是“**约束**”，“**any data written to the database must be valid according to all defined rules** ”。

如何理解约束？这里引用知乎问题 **如何理解数据库的内部一致性和外部一致性**，蚂蚁金服 OceanBase 研发专家韩富晟回答的一段话：

> “约束”由数据库的使用者告诉数据库，使用者要求数据一定符合这样或者那样的约束。当数据发生修改时，数据库会检查数据是否还符合约束条件，如果约束条件不再被满足，那么修改操作不会发生。
>
> 关系数据库最常见的两类约束是“唯一性约束”和“完整性约束”，表格中定义的主键和唯一键都保证了指定的数据项绝不会出现重复，表格之间定义的参照完整性也保证了同一个属性在不同表格中的一致性。
>
> “ Consistency in ACID ”是如此的好用，以至于已经融化在大部分使用者的血液里了，使用者会在表格设计的时候自觉的加上需要的约束条件，数据库也会严格的执行这个约束条件。

所以**事务的一致性和预先定义的约束有关，保证了约束即保证了一致性**。

我们细细品一品这句话： **This prevents database corruption by an illegal transaction, but does not guarantee that a transaction is correct**。

写到这里可能大家还是有点模糊，我们举经典**转账**的案例。 

我们开启一个事务，张三和李四账号上的初始余额都是1000元，并且余额字段没有任何约束。张三给李四转账1200元。张三的余额更新为 -200 ， 李四的余额更新为2200。

从应用层面来看，这个事务明显不合法，因为现实场景中，用户余额不可能小于 0 ， 但是它完全遵循数据库的约束，所以从数据库层面来看，这个事务依然保证了一致性。

Redis 的事务一致性是指：Redis 事务在执行过程中符合数据库的约束，没有包含非法或者无效的错误数据。

我们分三种异常场景分别讨论：

1. 执行 EXEC 命令前，客户端发送的操作命令错误，事务终止，数据保持一致性；
2. 执行 EXEC 命令后，命令和操作的数据类型不匹配，错误的命令会报错，但事务不会因为错误的命令而终止，而是会继续执行。正确的命令正常执行，错误的命令报错，从这个角度来看，数据也可以保持一致性；
3. 执行事务的过程中，Redis 服务宕机。这里需要考虑服务配置的持久化模式。
   - 无持久化的内存模式：服务重启之后，数据库没有保持数据，因此数据都是保持一致性的；
   - RDB / AOF 模式： 服务重启后，Redis 通过 RDB / AOF 文件恢复数据，数据库会还原到一致的状态。

综上所述，**在一致性的核心是约束的语意下，Redis 的事务可以保证一致性**。

1. 《设计数据密集型应用》

这本书是分布式系统入门的神书。在事务这一章节有一段关于 ACID 的解释：

![img](https://www.javayong.cn/pics/temp//zOQBAJrpdO.webp!large)

> Atomicity, isolation, and durability are properties of the database,whereas consistency (in the ACID sense) is a property of the application. The application may rely on the database’s atomicity and isolation properties in order to achieve consistency, but it’s not up to the database alone. Thus, the letter C doesn’t really belong in ACID.

原子性，隔离性和持久性是数据库的属性，而一致性（在 ACID 意义上）是应用程序的属性。应用可能依赖数据库的原子性和隔离属性来实现一致性，但这并不仅取决于数据库。因此，字母 C 不属于 ACID 。

很多时候，我们一直在纠结的一致性，其实就是指**符合现实世界的一致性**，现实世界的一致性才是事务追求的最终目标。

为了实现现实世界的一致性，需要满足如下几点：

1. 保证原子性，持久性和隔离性，如果这些特征都无法保证，那么事务的一致性也无法保证；
2. 数据库本身的约束，比如字符串长度不能超过列的限制或者唯一性约束；
3. 业务层面同样需要进行保障 。

### 2.5 事务特点

我们通常称 Redis 为内存数据库 ,  不同于传统的关系数据库，为了提供了更高的性能，更快的写入速度，在设计和实现层面做了一些平衡，并不能完全支持事务的 ACID。

Redis 的事务具备如下特点：

- 保证隔离性；
- 无法保证持久性；
- 具备了一定的原子性，但不支持回滚；
- 一致性的概念有分歧，假设在一致性的核心是约束的语意下，Redis 的事务可以保证一致性。

从工程角度来看，假设事务操作中每个步骤需要依赖上一个步骤返回的结果，则需要通过 watch 来实现乐观锁 。

## 3 Lua 脚本

### 3.1 简介

![](https://www.javayong.cn/pics/temp//0g0mSCwReL.webp!large)

Lua 由标准 C 编写而成，代码简洁优美，几乎在所有操作系统和平台上都可以编译，运行。Lua 脚本可以很容易的被 C/C ++ 代码调用，也可以反过来调用 C/C++ 的函数，这使得 Lua 在应用程序中可以被广泛应用。

Lua 脚本在游戏领域大放异彩，大家耳熟能详的《大话西游II》，《魔兽世界》都大量使用 Lua 脚本。Java 后端工程师接触过的 api 网关，比如 **Openresty** ，**Kong** 都可以看到 Lua 脚本的身影。

从 Redis 2.6.0 版本开始， Redis内置的 Lua 解释器，可以实现在 Redis 中运行 Lua 脚本。

使用 Lua 脚本的好处 ：

- 减少网络开销。将多个请求通过脚本的形式一次发送，减少网络时延。
- 原子操作。Redis会将整个脚本作为一个整体执行，中间不会被其他命令插入。
- 复用。客户端发送的脚本会永久存在 Redis 中，其他客户端可以复用这一脚本而不需要使用代码完成相同的逻辑。

Redis Lua 脚本常用命令：

| 序号 | 命令及描述                                                   |
| ---- | ------------------------------------------------------------ |
| 1    | EVAL script numkeys key [key ...] arg [arg ...] 执行 Lua 脚本。 |
| 2    | EVALSHA sha1 numkeys key [key ...] arg [arg ...] 执行 Lua 脚本。 |
| 3    | SCRIPT EXISTS script [script ...] 查看指定的脚本是否已经被保存在缓存当中。 |
| 4    | SCRIPT FLUSH 从脚本缓存中移除所有脚本。                      |
| 5    | SCRIPT KILL 杀死当前正在运行的 Lua 脚本。                    |
| 6    | SCRIPT LOAD script 将脚本 script 添加到脚本缓存中，但并不立即执行这个脚本。 |

### 3.2 EVAL 命令

命令格式：

```
 EVAL script numkeys key [key ...] arg [arg ...]
```

说明：

- `script`是第一个参数，为 Lua 5.1脚本；
- 第二个参数`numkeys`指定后续参数有几个 key；
- `key [key ...]`，是要操作的键，可以指定多个，在 Lua 脚本中通过`KEYS[1]`, `KEYS[2]`获取；
- `arg [arg ...]`，参数，在 Lua 脚本中通过`ARGV[1]`, `ARGV[2]`获取。

简单实例：

```
 redis> eval "return ARGV[1]" 0 100 
 "100"
 redis> eval "return {ARGV[1],ARGV[2]}" 0 100 101
 1) "100"
 2) "101"
 redis> eval "return {KEYS[1],KEYS[2],ARGV[1]}" 2 key1 key2 first second
 1) "key1"
 2) "key2"
 3) "first"
 4) "second"
```

下面演示下 Lua 如何调用 Redis 命令 ，通过`redis.call()`来执行了 Redis 命令 。

```
 redis> set mystring 'hello world'
 OK
 redis> get mystring
 "hello world"
 redis> EVAL "return redis.call('GET',KEYS[1])" 1 mystring
 "hello world"
 redis> EVAL "return redis.call('GET','mystring')" 0
 "hello world"
```

### 3.3 EVALSHA 命令

使用 EVAL 命令每次请求都需要传输 Lua 脚本 ，若 Lua 脚本过长，不仅会消耗网络带宽，而且也会对 Redis 的性能造成一定的影响。 

思路是先将 Lua 脚本先缓存起来 ,  返回给客户端 Lua 脚本的 sha1 摘要。 客户端存储脚本的 sha1 摘要 ，每次请求执行 EVALSHA  命令即可。

![img](https://www.javayong.cn/pics/temp//zokNNe0Swx.webp!large)

EVALSHA  命令基本语法如下：

```
 redis> EVALSHA sha1 numkeys key [key ...] arg [arg ...] 
```

实例如下：

```
 redis> SCRIPT LOAD "return 'hello world'"
 "5332031c6b470dc5a0dd9b4bf2030dea6d65de91"
 redis> EVALSHA 5332031c6b470dc5a0dd9b4bf2030dea6d65de91 0
 "hello world"
```

## 4 事务 VS Lua 脚本

> 从定义上来说， **Redis 中的脚本本身就是一种事务**， 所以任何在事务里可以完成的事， 在脚本里面也能完成。 并且一般来说， 使用**脚本要来得更简单，并且速度更快**。
>
> 因为脚本功能是 Redis 2.6 才引入的， 而事务功能则更早之前就存在了， 所以 Redis 才会同时存在两种处理事务的方法。
>
> 不过**我们并不打算在短时间内就移除事务功能**， 因为事务提供了一种即使不使用脚本， 也可以避免竞争条件的方法， 而且事务本身的实现并不复杂。
>
> --  https://redis.io/

Lua 脚本是另一种形式的事务，他具备一定的原子性，但脚本报错的情况下，事务并不会回滚。Lua 脚本可以保证隔离性，而且可以完美的支持**后面的步骤依赖前面步骤的结果**。

 **Lua 脚本模式的身影几乎无处不在，比如分布式锁、延迟队列、抢红包等场景。**

不过在编写 Lua 脚本时，要注意如下两点：

1. 为了避免 Redis 阻塞，Lua 脚本业务逻辑不能过于复杂和耗时；
2. 仔细检查和测试 Lua 脚本 ，因为执行 Lua 脚本具备一定的原子性，不支持回滚。

