package com.synapsev.agentt.model;

/** DB 커넥션 풀 1개의 순간 값(개수). max 가 0 이하면 상한 미상(무제한 등). */
public final class PoolSample {
    public String name;
    /** jeus | hikari | tomcat | dbcp2 */
    public String kind;
    public int active;
    public int idle;
    public int max;
    /** 커넥션을 기다리는 스레드 수. */
    public int wait;
    /** 최근 5초 창(1초 폴링) 안 active 최대값. 항상 active 이상. */
    public int peak = -1;
}
