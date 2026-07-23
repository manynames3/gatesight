from gatesight_recognition_worker.handler import observation_id, outbox_id


def test_worker_uses_deterministic_ids_for_duplicate_sqs_delivery() -> None:
    capture_id = "cap_01J123456789ABCDEFGHJKMNPQ"
    assert observation_id(capture_id) == "obs_01J123456789ABCDEFGHJKMNPQ"
    assert outbox_id(capture_id) == "out_01J123456789ABCDEFGHJKMNPQ"
