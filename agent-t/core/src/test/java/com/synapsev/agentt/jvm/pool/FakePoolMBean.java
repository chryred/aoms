package com.synapsev.agentt.jvm.pool;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.management.Attribute;
import javax.management.AttributeList;
import javax.management.AttributeNotFoundException;
import javax.management.DynamicMBean;
import javax.management.MBeanAttributeInfo;
import javax.management.MBeanInfo;

/** 속성 맵으로 동작하는 테스트용 풀 MBean. 어떤 호출이 왔는지 기록한다(허용: getAttribute 뿐). */
public final class FakePoolMBean implements DynamicMBean {
    public final Map<String, Object> attrs = new LinkedHashMap<String, Object>();
    public final List<String> calls = Collections.synchronizedList(new ArrayList<String>());
    /** getAttribute 마다 이만큼 잔다(예산 테스트). */
    public volatile long sleepMs;

    public FakePoolMBean put(String k, Object v) {
        attrs.put(k, v);
        return this;
    }

    public Object getAttribute(String a) throws AttributeNotFoundException {
        calls.add("getAttribute:" + a);
        if (sleepMs > 0) {
            try {
                Thread.sleep(sleepMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (!attrs.containsKey(a)) {
            throw new AttributeNotFoundException(a);
        }
        Object v = attrs.get(a);
        if (v instanceof RuntimeException) {
            throw (RuntimeException) v;
        }
        return v;
    }

    public void setAttribute(Attribute a) {
        calls.add("setAttribute");
        throw new AssertionError("setAttribute 금지");
    }

    public AttributeList getAttributes(String[] names) {
        calls.add("getAttributes");
        throw new AssertionError("getAttributes 일괄 읽기 금지");
    }

    public AttributeList setAttributes(AttributeList l) {
        calls.add("setAttributes");
        throw new AssertionError("setAttributes 금지");
    }

    public Object invoke(String op, Object[] p, String[] s) {
        calls.add("invoke:" + op);
        throw new AssertionError("invoke 금지: " + op);
    }

    public MBeanInfo getMBeanInfo() {
        MBeanAttributeInfo[] infos = new MBeanAttributeInfo[attrs.size()];
        int i = 0;
        for (String k : attrs.keySet()) {
            infos[i++] = new MBeanAttributeInfo(k, "java.lang.Object", k, true, false, false);
        }
        return new MBeanInfo(FakePoolMBean.class.getName(), "fake", infos, null, null, null);
    }
}
