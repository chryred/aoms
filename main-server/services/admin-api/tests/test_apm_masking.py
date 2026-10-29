from services.apm_masking import mask_ip, mask_user


def test_mask_ip_v4():
    assert mask_ip("10.253.21.12") == "10.253.21.*"


def test_mask_ip_v6():
    assert mask_ip("2001:db8:85a3:8d3:1319:8a2e:370:7348") == "2001:db8:85a3:8d3:*"


def test_mask_user():
    assert mask_user("ab") == "**"
    assert mask_user("abcdef") == "ab****"
    assert mask_user("") == ""
